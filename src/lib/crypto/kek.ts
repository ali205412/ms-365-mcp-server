/**
 * KEK loader (plan 03-04, D-12 / SECUR-01).
 *
 * Source precedence:
 *   1. MS365_MCP_KEK env var (base64 32 bytes — dev convenience, wins on collision).
 *   2. Azure Key Vault secret `mcp-kek` when MS365_MCP_KEYVAULT_URL is set.
 *
 * Server refuses to start (prod mode) if neither source yields a valid
 * 32-byte key. In dev mode a fixed all-zero 32-byte KEK is used with a loud
 * warning — deliberately deterministic so a restart does NOT re-key all
 * wrapped DEKs to garbage.
 *
 * Lazy @azure/identity + @azure/keyvault-secrets imports mirror
 * src/secrets.ts:60-77 — keeps these as truly optional deps for stdio / dev
 * deployments that don't use Key Vault.
 *
 * Cached after first load — same pattern as src/secrets.ts cachedSecrets.
 * clearKekCache() is a test-only escape hatch.
 */
import logger from '../../logger.js';

const KEY_LENGTH = 32;

let cachedKek: Buffer | null = null;

/**
 * Load the KEK, consulting env then (optionally) Azure Key Vault. Returns the
 * cached Buffer on subsequent calls. Throws (prod mode) when neither source
 * yields a valid key.
 */
export async function loadKek(): Promise<Buffer> {
  if (cachedKek) return cachedKek;

  // Env first (dev convenience, D-12).
  const envKek = process.env.MS365_MCP_KEK?.trim();
  if (envKek) {
    const buf = Buffer.from(envKek, 'base64');
    validateKekOrThrow(buf, 'MS365_MCP_KEK');
    cachedKek = buf;
    logger.info('KEK loaded from MS365_MCP_KEK');
    return buf;
  }

  // Optional Key Vault — lazy import (style from src/secrets.ts:60-66).
  const vaultUrl = process.env.MS365_MCP_KEYVAULT_URL;
  if (vaultUrl) {
    const { DefaultAzureCredential } = await import('@azure/identity');
    const { SecretClient } = await import('@azure/keyvault-secrets');
    const client = new SecretClient(vaultUrl, new DefaultAzureCredential());
    logger.info({ vaultUrl }, 'Fetching KEK from Key Vault');
    const secret = await client.getSecret('mcp-kek');
    if (!secret.value) {
      throw new Error('Key Vault secret mcp-kek has no value');
    }
    const buf = Buffer.from(secret.value, 'base64');
    validateKekOrThrow(buf, 'Key Vault mcp-kek');
    cachedKek = buf;
    return buf;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'No KEK source available. Set MS365_MCP_KEK or MS365_MCP_KEYVAULT_URL ' +
        'in production. Generate: `openssl rand -base64 32`.'
    );
  }

  // WR-05 fix: require explicit opt-in for the zero-KEK dev fallback.
  // Without this, a developer running `docker compose up` on a laptop
  // without NODE_ENV=production set and without MS365_MCP_KEK exported
  // would silently encrypt production-adjacent data with a known zero key.
  // Treat it as an error rather than a recoverable warn so the misconfig
  // is loud and CI tests can grep for the explicit kekSource fingerprint.
  if (process.env.MS365_MCP_ALLOW_ZERO_KEK !== '1') {
    throw new Error(
      'No KEK configured and MS365_MCP_ALLOW_ZERO_KEK=1 not set. ' +
        'Generate: `openssl rand -base64 32` and export MS365_MCP_KEK=<value>. ' +
        'For non-production scratch use only, opt in with MS365_MCP_ALLOW_ZERO_KEK=1.'
    );
  }

  // Dev-only fixed KEK (deliberately deterministic — a restart must NOT
  // re-key previously-wrapped DEKs to garbage). NEVER use this in production.
  const ephemeral = Buffer.alloc(KEY_LENGTH, 0);
  // WR-05 fix: escalate to error level with a structured fingerprint
  // (kekSource: 'dev-zero-fallback') so CI tests, log scrapers, and
  // alerting pipelines can detect this misconfig deterministically.
  logger.error(
    { kekSource: 'dev-zero-fallback' },
    'SECURITY: Using fixed zero KEK (dev-only opt-in via MS365_MCP_ALLOW_ZERO_KEK=1; NEVER in production)'
  );
  cachedKek = ephemeral;
  return ephemeral;
}

function validateKekOrThrow(buf: Buffer, source: string): void {
  if (buf.length !== KEY_LENGTH) {
    throw new Error(`${source} must decode to exactly 32 bytes (got ${buf.length})`);
  }
}

/**
 * Reset the cached KEK. Test-only escape hatch — mirrors
 * src/secrets.ts clearSecretsCache.
 */
export function clearKekCache(): void {
  cachedKek = null;
}
