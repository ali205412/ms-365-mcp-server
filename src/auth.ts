import type { AccountInfo, Configuration } from '@azure/msal-node';
import { PublicClientApplication } from '@azure/msal-node';
import logger from './logger.js';
import fs, { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import os from 'os';
import { getSecrets, type AppSecrets } from './secrets.js';
import { getCloudEndpoints, getDefaultClientId } from './cloud-config.js';
import { PRODUCT_AUDIENCES, type Product, type ProductAudienceCtx } from './lib/auth/products.js';

// Token cache storage is file-based only (v2, SECUR-07 / D-04).
// v1 users should run `npx ms-365-mcp-server migrate-tokens` once to copy
// their OS-keychain entries to the file cache at getTokenCachePath() +
// getSelectedAccountPath(). See CHANGELOG.md for migration details.

interface EndpointConfig {
  pathPattern: string;
  method: string;
  toolName: string;
  scopes?: string[];
  workScopes?: string[];
  llmTip?: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const endpointsData = JSON.parse(
  readFileSync(path.join(__dirname, 'endpoints.json'), 'utf8')
) as EndpointConfig[];

const endpoints = {
  default: endpointsData,
};

const DEFAULT_TOKEN_CACHE_PATH = path.join(os.homedir(), '.ms-365-mcp-token-cache.json');
const DEFAULT_SELECTED_ACCOUNT_PATH = path.join(os.homedir(), '.ms-365-mcp-selected-account.json');

/**
 * Returns the token cache file path.
 * Uses MS365_MCP_TOKEN_CACHE_PATH env var if set, otherwise a user-owned
 * default outside the package/repository directory.
 */
function getTokenCachePath(): string {
  const envPath = process.env.MS365_MCP_TOKEN_CACHE_PATH?.trim();
  return envPath || DEFAULT_TOKEN_CACHE_PATH;
}

/**
 * Returns the selected-account file path.
 * Uses MS365_MCP_SELECTED_ACCOUNT_PATH env var if set, otherwise a user-owned
 * default outside the package/repository directory.
 */
function getSelectedAccountPath(): string {
  const envPath = process.env.MS365_MCP_SELECTED_ACCOUNT_PATH?.trim();
  return envPath || DEFAULT_SELECTED_ACCOUNT_PATH;
}

/**
 * Ensures the parent directory of a file path exists, creating it recursively if needed.
 */
function ensureParentDir(filePath: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function wrapCache(data: string): string {
  return JSON.stringify({ _cacheEnvelope: true, data, savedAt: Date.now() });
}

function unwrapCache(raw: string): { data: string; savedAt?: number } {
  try {
    const parsed = JSON.parse(raw);
    if (parsed._cacheEnvelope && typeof parsed.data === 'string') {
      return { data: parsed.data, savedAt: parsed.savedAt };
    }
  } catch {
    // not our envelope format
  }
  return { data: raw };
}

/**
 * Reconciles two cache strings when both exist (e.g., after a migration left
 * a stale source alongside the current one). Returns the envelope's inner
 * data for the newest savedAt. Retained as an exported helper for cache-stamp
 * unit tests and any future multi-source reconciliation (Phase 3).
 *
 * Primary vs secondary is a priority order: when neither has a savedAt
 * timestamp, primary wins. When only one has a timestamp, that one wins.
 * When both are timestamped, the newest wins (ties go to primary).
 */
function pickNewest(
  primaryRaw: string | undefined,
  secondaryRaw: string | undefined
): string | undefined {
  if (!primaryRaw && !secondaryRaw) return undefined;
  if (primaryRaw && !secondaryRaw) return unwrapCache(primaryRaw).data;
  if (!primaryRaw && secondaryRaw) return unwrapCache(secondaryRaw).data;

  const primary = unwrapCache(primaryRaw!);
  const secondary = unwrapCache(secondaryRaw!);

  if (primary.savedAt === undefined && secondary.savedAt === undefined) return primary.data;
  if (primary.savedAt !== undefined && secondary.savedAt === undefined) return primary.data;
  if (primary.savedAt === undefined && secondary.savedAt !== undefined) return secondary.data;
  return primary.savedAt! >= secondary.savedAt! ? primary.data : secondary.data;
}

/**
 * Creates MSAL configuration from secrets.
 * This is called during AuthManager initialization.
 */
function createMsalConfig(secrets: AppSecrets): Configuration {
  const cloudEndpoints = getCloudEndpoints(secrets.cloudType);
  return {
    auth: {
      clientId: secrets.clientId || getDefaultClientId(secrets.cloudType),
      authority: `${cloudEndpoints.authority}/${secrets.tenantId || 'common'}`,
    },
  };
}

interface ScopeHierarchy {
  [key: string]: string[];
}

const SCOPE_HIERARCHY: ScopeHierarchy = {
  'Mail.ReadWrite': ['Mail.Read'],
  'Calendars.ReadWrite': ['Calendars.Read'],
  'Files.ReadWrite': ['Files.Read'],
  'Tasks.ReadWrite': ['Tasks.Read'],
  'Contacts.ReadWrite': ['Contacts.Read'],
};

/**
 * Memoization cache for `buildScopesFromEndpoints`. Keyed by the argument
 * tuple (includeWorkAccountScopes, enabledToolsPattern, readOnly) — these
 * change rarely (effectively never within a process lifetime; driven by
 * CLI flags / env), so caching the result across repeated calls is safe.
 *
 * Before memoization, `buildScopesFromEndpoints` iterated the full
 * endpoints array once per invocation. It is called from the AuthManager
 * constructor AND from /.well-known/oauth-* metadata routes on every
 * probe (src/server.ts). Plan 01-09 / T-01-09c performance mitigation.
 *
 * Clone-on-return prevents downstream mutation from corrupting the cache.
 */
const scopeCache = new Map<string, string[]>();

function buildScopesFromEndpoints(
  includeWorkAccountScopes: boolean = false,
  enabledToolsPattern?: string,
  readOnly: boolean = false
): string[] {
  const cacheKey = `${includeWorkAccountScopes}:${enabledToolsPattern ?? ''}:${readOnly}`;
  const cached = scopeCache.get(cacheKey);
  if (cached) return [...cached];

  const scopesSet = new Set<string>();

  // Create regex for tool filtering if pattern is provided
  let enabledToolsRegex: RegExp | undefined;
  if (enabledToolsPattern) {
    try {
      enabledToolsRegex = new RegExp(enabledToolsPattern, 'i');
      logger.info(`Building scopes with tool filter pattern: ${enabledToolsPattern}`);
    } catch (error) {
      logger.error(
        `Invalid tool filter regex pattern: ${enabledToolsPattern}. Building scopes without filter.`
      );
    }
  }

  endpoints.default.forEach((endpoint) => {
    // Skip write operations in read-only mode
    if (readOnly && endpoint.method.toUpperCase() !== 'GET') {
      return;
    }

    // Skip endpoints that don't match the tool filter
    if (enabledToolsRegex && !enabledToolsRegex.test(endpoint.toolName)) {
      return;
    }

    // Skip endpoints that only have workScopes if not in work mode
    if (!includeWorkAccountScopes && !endpoint.scopes && endpoint.workScopes) {
      return;
    }

    // Add regular scopes
    if (endpoint.scopes && Array.isArray(endpoint.scopes)) {
      endpoint.scopes.forEach((scope) => scopesSet.add(scope));
    }

    // Add workScopes if in work mode
    if (includeWorkAccountScopes && endpoint.workScopes && Array.isArray(endpoint.workScopes)) {
      endpoint.workScopes.forEach((scope) => scopesSet.add(scope));
    }
  });

  // Scope hierarchy: if we have BOTH a higher scope (ReadWrite) AND lower scopes (Read),
  // keep only the higher scope since it includes the permissions of the lower scopes.
  // Do NOT upgrade Read to ReadWrite if we only have Read scopes.
  Object.entries(SCOPE_HIERARCHY).forEach(([higherScope, lowerScopes]) => {
    if (scopesSet.has(higherScope) && lowerScopes.every((scope) => scopesSet.has(scope))) {
      // We have both ReadWrite and Read, so remove the redundant Read scope
      lowerScopes.forEach((scope) => scopesSet.delete(scope));
    }
  });

  const scopes = Array.from(scopesSet);
  if (enabledToolsPattern) {
    logger.info(`Built ${scopes.length} scopes for filtered tools: ${scopes.join(', ')}`);
  }

  scopeCache.set(cacheKey, scopes);
  return [...scopes];
}

interface LoginTestResult {
  success: boolean;
  message: string;
  userData?: {
    displayName: string;
    userPrincipalName: string;
  };
}

class AuthManager {
  private config: Configuration;
  private scopes: string[];
  private msalApp: PublicClientApplication;
  private accessToken: string | null;
  private tokenExpiry: number | null;
  private oauthToken: string | null;
  private isOAuthMode: boolean;
  private selectedAccountId: string | null;
  private useInteractiveAuth: boolean;
  /**
   * Plan 5.1-06 Task 2 (D-05) — per-product access-token cache keyed by
   * composite `${tenantId}:${product}` so refresh tokens never collide
   * across product audiences or tenants. Entries carry the MSAL
   * `accessToken` + `expiry` (epoch ms); a 60-second safety buffer is
   * applied before the hit check in `getTokenForProduct`.
   *
   * T-5.1-06-b mitigation: the composite key prevents a cache entry for
   * `tenantA:powerbi` from satisfying a request for `tenantB:powerbi`.
   * T-5.1-06-f mitigation: `evictProductTokensForTenant(tenantId)` drops
   * every matching entry on tenant-disable (Phase 3 TenantPool hook).
   *
   * Bounded by active-tenant × 5-products. For the reference Docker
   * Compose single-VM deploy (Phase 6 rate limiting + tenant LRU) this
   * is deterministic and small — Phase 6 can wrap with an explicit LRU
   * layer if the registered-tenant count exceeds operational thresholds.
   */
  private productTokenCache: Map<string, { token: string; expiry: number }> = new Map();

  constructor(config: Configuration, scopes: string[] = buildScopesFromEndpoints()) {
    logger.info(`And scopes are ${scopes.join(', ')}`, scopes);
    this.config = config;
    this.scopes = scopes;
    this.msalApp = new PublicClientApplication(this.config);
    this.accessToken = null;
    this.tokenExpiry = null;
    this.selectedAccountId = null;
    this.useInteractiveAuth = false;

    const oauthTokenFromEnv = process.env.MS365_MCP_OAUTH_TOKEN;
    this.oauthToken = oauthTokenFromEnv ?? null;
    this.isOAuthMode = oauthTokenFromEnv != null;
  }

  /**
   * Creates an AuthManager instance with secrets loaded from the configured provider.
   * Uses Key Vault if MS365_MCP_KEYVAULT_URL is set, otherwise environment variables.
   */
  static async create(scopes: string[] = buildScopesFromEndpoints()): Promise<AuthManager> {
    const secrets = await getSecrets();
    const config = createMsalConfig(secrets);
    return new AuthManager(config, scopes);
  }

  async loadTokenCache(): Promise<void> {
    try {
      const cachePath = getTokenCachePath();
      if (existsSync(cachePath)) {
        const fileRaw = readFileSync(cachePath, 'utf8');
        const cacheData = unwrapCache(fileRaw).data;
        if (cacheData) {
          this.msalApp.getTokenCache().deserialize(cacheData);
        }
      }

      // Load selected account
      await this.loadSelectedAccount();
    } catch (error) {
      logger.error(`Error loading token cache: ${(error as Error).message}`);
    }
  }

  private async loadSelectedAccount(): Promise<void> {
    try {
      const accountPath = getSelectedAccountPath();
      if (!existsSync(accountPath)) {
        return;
      }
      const fileRaw = readFileSync(accountPath, 'utf8');
      const selectedAccountData = unwrapCache(fileRaw).data;
      if (selectedAccountData) {
        const parsed = JSON.parse(selectedAccountData);
        this.selectedAccountId = parsed.accountId;
        logger.info(`Loaded selected account: ${this.selectedAccountId}`);
      }
    } catch (error) {
      logger.error(`Error loading selected account: ${(error as Error).message}`);
    }
  }

  async saveTokenCache(): Promise<void> {
    try {
      const stamped = wrapCache(this.msalApp.getTokenCache().serialize());
      const cachePath = getTokenCachePath();
      ensureParentDir(cachePath);
      fs.writeFileSync(cachePath, stamped, { mode: 0o600 });
    } catch (error) {
      logger.error(`Error saving token cache: ${(error as Error).message}`);
    }
  }

  private async saveSelectedAccount(): Promise<void> {
    try {
      const stamped = wrapCache(JSON.stringify({ accountId: this.selectedAccountId }));
      const accountPath = getSelectedAccountPath();
      ensureParentDir(accountPath);
      fs.writeFileSync(accountPath, stamped, { mode: 0o600 });
    } catch (error) {
      logger.error(`Error saving selected account: ${(error as Error).message}`);
    }
  }

  async setOAuthToken(token: string): Promise<void> {
    this.oauthToken = token;
    this.isOAuthMode = true;
  }

  async getToken(forceRefresh = false): Promise<string | null> {
    if (this.isOAuthMode && this.oauthToken) {
      return this.oauthToken;
    }

    if (this.accessToken && this.tokenExpiry && this.tokenExpiry > Date.now() && !forceRefresh) {
      return this.accessToken;
    }

    const currentAccount = await this.getCurrentAccount();

    if (currentAccount) {
      const silentRequest = {
        account: currentAccount,
        scopes: this.scopes,
      };

      try {
        const response = await this.msalApp.acquireTokenSilent(silentRequest);
        this.accessToken = response.accessToken;
        this.tokenExpiry = response.expiresOn ? new Date(response.expiresOn).getTime() : null;
        await this.saveTokenCache();
        return this.accessToken;
      } catch {
        logger.error('Silent token acquisition failed');
        throw new Error('Silent token acquisition failed');
      }
    }

    throw new Error('No valid token found');
  }

  async getCurrentAccount(): Promise<AccountInfo | null> {
    const accounts = await this.msalApp.getTokenCache().getAllAccounts();

    if (accounts.length === 0) {
      return null;
    }

    // If a specific account is selected, find it
    if (this.selectedAccountId) {
      const selectedAccount = accounts.find(
        (account: AccountInfo) => account.homeAccountId === this.selectedAccountId
      );
      if (selectedAccount) {
        return selectedAccount;
      }
      logger.warn(
        `Selected account ${this.selectedAccountId} not found, falling back to first account`
      );
    }

    // Fall back to first account (backward compatibility)
    return accounts[0];
  }

  /**
   * Phase 3 note: Device-code flow (AUTH-04) is preserved for stdio mode.
   * HTTP mode uses TenantPool (src/lib/tenant/tenant-pool.ts) with
   * ConfidentialClientApplication (app-only) or PublicClientApplication
   * (delegated-without-secret). Bearer mode bypasses MSAL entirely
   * (src/lib/microsoft-auth.ts createBearerMiddleware — plan 03-06).
   *
   * This AuthManager.acquireTokenByDeviceCode remains for:
   *   - Stdio mode with `--tenant-id=<id>` (single-tenant)
   *   - File-backed MSAL cache (no Redis dependency)
   *   - `ms-365-mcp-server --login` one-shot CLI
   *
   * Wire chart (03-06):
   *
   *   stdio transport → AuthManager.create() → acquireTokenByDeviceCode (THIS)
   *   HTTP delegated  → TenantPool.acquire(tenant) → MSAL.acquireTokenByCode
   *   HTTP app-only   → TenantPool.acquire(tenant) → MSAL.acquireTokenByClientCredential
   *   HTTP bearer     → createBearerMiddleware → requestContext (no MSAL)
   */
  async acquireTokenByDeviceCode(hack?: (message: string) => void): Promise<string | null> {
    const deviceCodeRequest = {
      scopes: this.scopes,
      deviceCodeCallback: (response: { message: string }) => {
        const text = ['\n', response.message, '\n'].join('');
        if (hack) {
          hack(text + 'After login run the "verify login" command');
        } else {
          console.log(text);
        }
        logger.info('Device code login initiated');
      },
    };

    try {
      logger.info('Requesting device code...');
      logger.info(`Requesting scopes: ${this.scopes.join(', ')}`);
      const response = await this.msalApp.acquireTokenByDeviceCode(deviceCodeRequest);
      logger.info(`Granted scopes: ${response?.scopes?.join(', ') || 'none'}`);
      logger.info('Device code login successful');
      this.accessToken = response?.accessToken || null;
      this.tokenExpiry = response?.expiresOn ? new Date(response.expiresOn).getTime() : null;

      // Set the newly authenticated account as selected if no account is currently selected
      if (!this.selectedAccountId && response?.account) {
        this.selectedAccountId = response.account.homeAccountId;
        await this.saveSelectedAccount();
        logger.info(`Auto-selected new account: ${response.account.username}`);
      }

      await this.saveTokenCache();
      return this.accessToken;
    } catch (error) {
      logger.error(`Error in device code flow: ${(error as Error).message}`);
      throw error;
    }
  }

  setUseInteractiveAuth(value: boolean): void {
    this.useInteractiveAuth = value;
  }

  getUseInteractiveAuth(): boolean {
    return this.useInteractiveAuth;
  }

  async acquireTokenInteractive(hack?: (message: string) => void): Promise<string | null> {
    const open = (await import('open')).default;

    const interactiveRequest = {
      scopes: this.scopes,
      openBrowser: async (url: string) => {
        const message = 'Opening browser for Microsoft sign-in...';
        if (hack) {
          hack(message);
        }
        logger.info(message);
        await open(url);
      },
      successTemplate:
        '<h1>Authentication successful!</h1><p>You can close this window and return to your application.</p>',
      errorTemplate: '<h1>Authentication failed</h1><p>Something went wrong. Please try again.</p>',
    };

    try {
      logger.info('Requesting interactive browser login...');
      logger.info(`Requesting scopes: ${this.scopes.join(', ')}`);
      const response = await this.msalApp.acquireTokenInteractive(interactiveRequest);
      logger.info(`Granted scopes: ${response?.scopes?.join(', ') || 'none'}`);
      logger.info('Interactive browser login successful');
      this.accessToken = response?.accessToken || null;
      this.tokenExpiry = response?.expiresOn ? new Date(response.expiresOn).getTime() : null;

      // Set the newly authenticated account as selected if no account is currently selected
      if (!this.selectedAccountId && response?.account) {
        this.selectedAccountId = response.account.homeAccountId;
        await this.saveSelectedAccount();
        logger.info(`Auto-selected new account: ${response.account.username}`);
      }

      await this.saveTokenCache();
      return this.accessToken;
    } catch (error) {
      logger.error(`Error in interactive browser flow: ${(error as Error).message}`);
      throw error;
    }
  }

  async testLogin(): Promise<LoginTestResult> {
    try {
      logger.info('Testing login...');
      const token = await this.getToken();

      if (!token) {
        logger.error('Login test failed - no token received');
        return {
          success: false,
          message: 'Login failed - no token received',
        };
      }

      logger.info('Token retrieved successfully, testing Graph API access...');

      try {
        const secrets = await getSecrets();
        const cloudEndpoints = getCloudEndpoints(secrets.cloudType);
        const response = await fetch(`${cloudEndpoints.graphApi}/v1.0/me`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (response.ok) {
          const userData = await response.json();
          logger.info('Graph API user data fetch successful');
          return {
            success: true,
            message: 'Login successful',
            userData: {
              displayName: userData.displayName,
              userPrincipalName: userData.userPrincipalName,
            },
          };
        } else {
          const errorText = await response.text();
          logger.error(`Graph API user data fetch failed: ${response.status} - ${errorText}`);
          return {
            success: false,
            message: `Login successful but Graph API access failed: ${response.status}`,
          };
        }
      } catch (graphError) {
        logger.error(`Error fetching user data: ${(graphError as Error).message}`);
        return {
          success: false,
          message: `Login successful but Graph API access failed: ${(graphError as Error).message}`,
        };
      }
    } catch (error) {
      logger.error(`Login test failed: ${(error as Error).message}`);
      return {
        success: false,
        message: `Login failed: ${(error as Error).message}`,
      };
    }
  }

  async logout(): Promise<boolean> {
    try {
      const accounts = await this.msalApp.getTokenCache().getAllAccounts();
      for (const account of accounts) {
        await this.msalApp.getTokenCache().removeAccount(account);
      }
      this.accessToken = null;
      this.tokenExpiry = null;
      this.selectedAccountId = null;

      const cachePath = getTokenCachePath();
      if (fs.existsSync(cachePath)) {
        fs.unlinkSync(cachePath);
      }

      const accountPath = getSelectedAccountPath();
      if (fs.existsSync(accountPath)) {
        fs.unlinkSync(accountPath);
      }

      return true;
    } catch (error) {
      logger.error(`Error during logout: ${(error as Error).message}`);
      throw error;
    }
  }

  // Multi-account support methods
  async listAccounts(): Promise<AccountInfo[]> {
    return await this.msalApp.getTokenCache().getAllAccounts();
  }

  async selectAccount(identifier: string): Promise<boolean> {
    const account = await this.resolveAccount(identifier);

    this.selectedAccountId = account.homeAccountId;
    await this.saveSelectedAccount();

    // Clear cached tokens to force refresh with new account
    this.accessToken = null;
    this.tokenExpiry = null;

    logger.info(`Selected account: ${account.username} (${account.homeAccountId})`);
    return true;
  }

  async removeAccount(identifier: string): Promise<boolean> {
    const account = await this.resolveAccount(identifier);

    try {
      await this.msalApp.getTokenCache().removeAccount(account);

      // If this was the selected account, clear the selection
      if (this.selectedAccountId === account.homeAccountId) {
        this.selectedAccountId = null;
        await this.saveSelectedAccount();
        this.accessToken = null;
        this.tokenExpiry = null;
      }

      logger.info(`Removed account: ${account.username} (${account.homeAccountId})`);
      return true;
    } catch (error) {
      logger.error(`Failed to remove account ${identifier}: ${(error as Error).message}`);
      return false;
    }
  }

  getSelectedAccountId(): string | null {
    return this.selectedAccountId;
  }

  /**
   * Returns true if auth is in OAuth/HTTP mode (token supplied via env or setOAuthToken).
   * In this mode, account resolution should be skipped — the request context drives token selection.
   */
  isOAuthModeEnabled(): boolean {
    return this.isOAuthMode;
  }

  /**
   * Resolves an account by identifier (email or homeAccountId).
   * Resolution: username match (case-insensitive) → homeAccountId match → throw.
   */
  async resolveAccount(identifier: string): Promise<AccountInfo> {
    const accounts = await this.msalApp.getTokenCache().getAllAccounts();

    if (accounts.length === 0) {
      throw new Error('No accounts found. Please login first.');
    }

    const lowerIdentifier = identifier.toLowerCase();

    // Try username (email) match first
    let account =
      accounts.find((a: AccountInfo) => a.username?.toLowerCase() === lowerIdentifier) ?? null;

    // Fall back to homeAccountId match
    if (!account) {
      account = accounts.find((a: AccountInfo) => a.homeAccountId === identifier) ?? null;
    }

    if (!account) {
      const availableAccounts = accounts
        .map((a: AccountInfo) => a.username || a.name || 'unknown')
        .join(', ');
      throw new Error(
        `Account '${identifier}' not found. Available accounts: ${availableAccounts}`
      );
    }

    return account;
  }

  /**
   * Returns true if the MSAL cache contains more than one account.
   * Used to decide whether to inject the `account` parameter into tool schemas.
   */
  async isMultiAccount(): Promise<boolean> {
    const accounts = await this.msalApp.getTokenCache().getAllAccounts();
    return accounts.length > 1;
  }

  /**
   * Acquires a token for a specific account identified by username (email) or homeAccountId,
   * WITHOUT changing the persisted selectedAccountId.
   *
   * Resolution order:
   *  1. Exact match on username (case-insensitive)
   *  2. Exact match on homeAccountId
   *  3. If identifier is empty/undefined AND only 1 account exists → auto-select
   *  4. If identifier is empty/undefined AND multiple accounts → use selectedAccountId or throw
   *
   * @returns The access token string.
   */
  async getTokenForAccount(identifier?: string): Promise<string> {
    if (this.isOAuthMode && this.oauthToken) {
      return this.oauthToken;
    }

    let targetAccount: AccountInfo | null = null;

    if (identifier) {
      // resolveAccount handles empty-cache check internally
      targetAccount = await this.resolveAccount(identifier);
    } else {
      const accounts = await this.msalApp.getTokenCache().getAllAccounts();

      if (accounts.length === 0) {
        throw new Error('No accounts found. Please login first.');
      }
      // No identifier provided
      if (accounts.length === 1) {
        targetAccount = accounts[0];
      } else {
        // Multiple accounts: resolve by explicit selectedAccountId only — never fall back to accounts[0].
        // getCurrentAccount() has backward-compat fallback to first account which is unsafe for multi-account routing.
        if (this.selectedAccountId) {
          targetAccount =
            accounts.find((a: AccountInfo) => a.homeAccountId === this.selectedAccountId) ?? null;
        }
        if (!targetAccount) {
          const availableAccounts = accounts
            .map((a: AccountInfo) => a.username || a.name || 'unknown')
            .join(', ');
          throw new Error(
            `Multiple accounts configured but no 'account' parameter provided and no default selected. ` +
              `Available accounts: ${availableAccounts}. ` +
              `Pass account="<email>" in your tool call or use select-account to set a default.`
          );
        }
      }
    }

    const silentRequest = {
      account: targetAccount,
      scopes: this.scopes,
    };

    try {
      const response = await this.msalApp.acquireTokenSilent(silentRequest);
      await this.saveTokenCache();
      return response.accessToken;
    } catch {
      throw new Error(
        `Failed to acquire token for account '${targetAccount.username || targetAccount.name || 'unknown'}'. ` +
          `The token may have expired. Please re-login with: --login`
      );
    }
  }

  /**
   * Plan 5.1-06 Task 2 — acquire a product-specific access token via MSAL
   * against the product's `.default` scope (per 05.1-CONTEXT D-05 audience
   * table) and cache under composite key `${tenantId}:${product}`.
   *
   * Cache policy:
   *   - Hit with expiry > now + 60s safety buffer → return cached token.
   *   - Hit with expiry within the 60s buffer → call MSAL again (refresh).
   *   - Miss → call MSAL, populate cache on success. MSAL failure does NOT
   *     populate the cache (error propagates through logger.error + throw).
   *
   * Product scope resolution:
   *   - Static products (powerbi, pwrapps, pwrauto, exo): literal string.
   *   - Dynamic (sp-admin): computed from `opts.sharepointDomain` via the
   *     PRODUCT_AUDIENCES table's function-style scope resolver, which
   *     re-validates the value against Zod `/^[a-z0-9-]{1,63}$/` BEFORE
   *     calling MSAL (T-5.1-06-c defense-in-depth — invalid values never
   *     reach MSAL's `.acquireTokenSilent`).
   *
   * Pitfall 11 (product-token cache staleness on tenant disable): closed by
   * `evictProductTokensForTenant(tenantId)` — callers MUST invoke the
   * eviction API from the TenantPool eviction hook on tenant-disable.
   *
   * @param tenantId Tenant GUID — becomes the first half of the cache key.
   * @param product  Product identifier (Product enum — 5 members per D-05).
   * @param opts     Optional context for dynamic scope/baseUrl resolvers.
   *   - `sharepointDomain` required for `sp-admin`; throws if absent/malformed.
   *   - `tenantAzureId` used by dispatch for `exo` baseUrl (not for scope).
   * @returns The product-specific access token (string).
   * @throws   Error when no MSAL account is available, when the product
   *           scope can't be computed (malformed context), or when
   *           `acquireTokenSilent` fails.
   */
  async getTokenForProduct(
    tenantId: string,
    product: Product,
    opts: ProductAudienceCtx = {}
  ): Promise<string> {
    const cacheKey = `${tenantId}:${product}`;
    const cached = this.productTokenCache.get(cacheKey);
    // 60-second safety buffer — return the cached token only if it will
    // still be valid 60 seconds from now. This matches research §Pattern 3
    // reference and prevents mid-request 401s when an expiring token is
    // handed to a downstream request whose round-trip exceeds the remaining
    // lifetime. The cache entry is evicted on refresh via the `set()` call
    // below regardless.
    if (cached && cached.expiry > Date.now() + 60_000) {
      return cached.token;
    }

    const audience = PRODUCT_AUDIENCES.get(product);
    if (!audience) {
      throw new Error(`Unknown product: ${product}`);
    }

    // Function-style scope resolvers validate their context and throw BEFORE
    // reaching MSAL — invalid sharepoint_domain / absent values never
    // produce an MSAL call.
    const scope = typeof audience.scope === 'function' ? audience.scope(opts) : audience.scope;

    const currentAccount = await this.getCurrentAccount();
    if (!currentAccount) {
      throw new Error('No account available for product token acquisition');
    }

    try {
      const response = await this.msalApp.acquireTokenSilent({
        account: currentAccount,
        scopes: [scope],
      });
      // MSAL reports absolute expiry; default to a conservative 30min if
      // absent (should never happen — documented for defensive completeness).
      const expiry = response.expiresOn
        ? new Date(response.expiresOn).getTime()
        : Date.now() + 30 * 60_000;
      this.productTokenCache.set(cacheKey, { token: response.accessToken, expiry });
      return response.accessToken;
    } catch (err) {
      logger.error(`getTokenForProduct failed for ${cacheKey}: ${(err as Error).message}`);
      throw err;
    }
  }

  /**
   * Plan 5.1-06 Task 2 — evict every per-product cache entry for the given
   * tenant. Called from TenantPool eviction hook on tenant-disable
   * (T-5.1-06-f + Phase 3 TENANT-07 extension) — closes research Pitfall
   * 11's race window where a disabled tenant's cached product tokens keep
   * resolving after the MSAL cache itself was cryptoshredded.
   *
   * Implementation iterates the Map keys and drops entries whose key starts
   * with `${tenantId}:`. The 5-products-per-tenant ceiling makes this O(5)
   * per call regardless of process-wide tenant count.
   *
   * @param tenantId Tenant GUID.
   */
  evictProductTokensForTenant(tenantId: string): void {
    const prefix = `${tenantId}:`;
    for (const key of this.productTokenCache.keys()) {
      if (key.startsWith(prefix)) {
        this.productTokenCache.delete(key);
      }
    }
  }
}

// ── Phase 3 plan 03-05: per-tenant factory seam ─────────────────────────────
// v1 AuthManager is single-tenant and binds MSAL state to process-global
// secrets. Phase 3 rewires HTTP-mode to a TenantPool — this thin factory
// exposes a shape per-request callers (03-06 flows, 03-08 routing) use to
// acquire MSAL clients through the pool rather than through the stdio
// AuthManager.create() path. Stdio mode keeps AuthManager.create() for
// device-code + file-backed cache (D-04).
//
// This function is deliberately minimal — 03-06 is where per-flow
// acquireToken orchestration lives. Type imports are intentionally typeof
// references so importing this file does not pull tenant-pool/tenant-row
// (and their Azure/ioredis chain) into stdio mode bootstrap.

/**
 * Factory returning a thin handle that couples a TenantRow with a
 * TenantPool. Callers invoke `handle.pool.acquire(handle.tenant)` to obtain
 * the MSAL client for this tenant. Returned handle is trivially copyable —
 * it holds references only, no lifecycle state.
 */
export function forTenant<TPool extends { acquire: (t: TTenant) => unknown }, TTenant>(
  tenant: TTenant,
  pool: TPool
): { pool: TPool; tenant: TTenant } {
  return { pool, tenant };
}

export default AuthManager;
export {
  buildScopesFromEndpoints,
  getTokenCachePath,
  getSelectedAccountPath,
  wrapCache,
  unwrapCache,
  pickNewest,
};
