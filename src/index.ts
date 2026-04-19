#!/usr/bin/env node
import './lib/otel.js'; // MUST be first import — registers OTel instrumentation hooks before anything else loads
// Note: OTel reads OTEL_EXPORTER_OTLP_ENDPOINT from process.env at SDK start time.
// This MUST run BEFORE dotenv/config so that in production the env var comes from
// the real environment (systemd / Docker / CI), not from .env.
import 'dotenv/config';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, type CommandOptions } from './cli.js';
import logger from './logger.js';
import AuthManager, { buildScopesFromEndpoints, getTokenCachePath } from './auth.js';
import MicrosoftGraphServer, { parseHttpOption } from './server.js';
import { registerShutdownHooks } from './lib/shutdown.js';
import type { ReadinessCheck } from './lib/health.js';
import * as postgres from './lib/postgres.js';
import { version } from './version.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Probe /healthz and return an exit code suitable for Docker HEALTHCHECK.
 *
 * Behaviour:
 *   - stdio mode (no --http): exits 0 — the stdio transport is invoked
 *     per-request by the MCP client, so process-is-alive is the only
 *     meaningful liveness signal.
 *   - HTTP mode: HTTP GET /healthz on the configured port with 3s timeout.
 *     Exit 0 on HTTP 200, exit 1 on any other status, connection refused,
 *     or timeout.
 *
 * This short-circuit MUST NOT initialize MSAL, load secrets, or start a
 * server — it is invoked by the Docker HEALTHCHECK every 30s and must be
 * cheap.
 */
async function runHealthCheck(args: CommandOptions): Promise<number> {
  if (!args.http) {
    // stdio mode: no HTTP server to probe. If we reached this line, the
    // process is alive and healthy enough to execute Node.
    return 0;
  }

  const { host, port } = parseHttpOption(args.http);
  const probeHost = host ?? '127.0.0.1';

  return new Promise<number>((resolve) => {
    const req = http.get({ hostname: probeHost, port, path: '/healthz', timeout: 3000 }, (res) => {
      // Drain the response so the socket closes cleanly.
      res.resume();
      resolve(res.statusCode === 200 ? 0 : 1);
    });
    req.on('error', () => resolve(1));
    req.on('timeout', () => {
      req.destroy();
      resolve(1);
    });
  });
}

/**
 * Sysexits EX_CONFIG — "the configuration file was invalid in some way"
 * (https://man.openbsd.org/sysexits.3). Used for fail-fast exits when a
 * required production env var is missing. Distinct from the generic exit 1
 * so operators + Docker restart policies can differentiate config errors
 * from transient crashes.
 */
const EX_CONFIG = 78;

/**
 * Advisory probe for v1 OS-keychain (keytar) leftovers on stdio startup
 * (SECUR-07 / D-04). Runs ONLY when:
 *   - we're in stdio mode (HTTP/SSE transports never used the keychain)
 *   - the file-based token cache does not yet exist (so the probe is a
 *     one-time nudge, not recurring startup noise)
 *
 * The probe is spawned as a separate process so a missing keytar does
 * not pull the native module into our address space. Exit code is
 * advisory only (2 = leftovers present); the server continues regardless
 * so a broken or missing probe cannot block startup.
 */
function maybeProbeKeytarLeftovers(args: CommandOptions): void {
  if (args.http) return;
  try {
    const cachePath = getTokenCachePath();
    if (existsSync(cachePath)) return;

    // Dev (src/index.ts) and prod (dist/index.js) resolve the same relative path.
    const probePath = path.resolve(__dirname, '..', 'bin', 'check-keytar-leftovers.cjs');
    if (!existsSync(probePath)) return;

    // Advisory: the probe writes to stderr if leftovers are detected. Result
    // is intentionally ignored — a probe failure is never fatal.
    const result = spawnSync(process.execPath, [probePath], { stdio: 'inherit' });
    void result;
  } catch {
    // Probe failures must not block server startup.
  }
}

/**
 * Fail-fast validation for production HTTP-mode config (plan 01-07 /
 * D-02 / SECUR-04).
 *
 * In prod HTTP mode both MS365_MCP_PUBLIC_URL and an explicit CORS
 * allowlist MUST be set — running half-configured would silently produce
 * broken OAuth metadata (unreachable issuer URLs) and/or an open-gate
 * CORS posture. We exit EX_CONFIG (78) before any server resources are
 * allocated so the operator gets a loud, early error with remediation
 * guidance.
 *
 * Stdio mode skips both checks: those env vars are HTTP-only. Dev mode
 * (NODE_ENV != 'production') is permissive — loopback is auto-allowed
 * and OAuth metadata uses the request origin.
 *
 * The deprecated singular MS365_MCP_CORS_ORIGIN (v1) and
 * MS365_MCP_BASE_URL (v1) are honored as fallbacks so existing
 * deployments don't break on upgrade — they emit a warn log in
 * src/server.ts at startup (computeCorsAllowlist / publicBase resolution).
 */
function validateProdHttpConfig(args: CommandOptions): void {
  if (!args.http) return;
  if (process.env.NODE_ENV !== 'production') return;

  const hasPublicUrl =
    !!process.env.MS365_MCP_PUBLIC_URL?.trim() || !!process.env.MS365_MCP_BASE_URL?.trim();
  if (!hasPublicUrl) {
    const message =
      'MS365_MCP_PUBLIC_URL is required in production HTTP mode (NODE_ENV=production). ' +
      'Set it to the externally-reachable origin (e.g., https://mcp.example.com). ' +
      'Deprecated MS365_MCP_BASE_URL is accepted as a fallback. ' +
      'Dev mode (NODE_ENV != production) permits it to be unset.';
    logger.error(message);
    // Secondary write to stderr so tests can grep the variable name even
    // when pino's transport routes the log record to stdout in prod mode.
    process.stderr.write(`[STARTUP CONFIG ERROR] ${message}\n`);
    process.exit(EX_CONFIG); // process.exit(78) — sysexits EX_CONFIG
  }

  const hasPluralCors = !!process.env.MS365_MCP_CORS_ORIGINS?.trim();
  const hasSingularCors = !!process.env.MS365_MCP_CORS_ORIGIN?.trim();
  if (!hasPluralCors && !hasSingularCors) {
    const message =
      'MS365_MCP_CORS_ORIGINS is required in production HTTP mode (NODE_ENV=production). ' +
      'Set it to a comma-separated list of allowed origins ' +
      '(e.g., https://app.example.com,https://desktop.example.com). ' +
      'Deprecated MS365_MCP_CORS_ORIGIN (singular) is accepted as a fallback. ' +
      'Dev mode (NODE_ENV != production) permits it to be unset (any http://localhost:* origin is auto-allowed).';
    logger.error(message);
    process.stderr.write(`[STARTUP CONFIG ERROR] ${message}\n`);
    process.exit(EX_CONFIG); // process.exit(78) — sysexits EX_CONFIG
  }
}

/**
 * Phase 3 (plan 03-01 Task 2) graceful-shutdown orchestrator.
 *
 * Runs in parallel with the Phase 1 shutdown handler installed by
 * `registerShutdownHooks()`. The Phase 1 handler owns server.close +
 * pino.flush + OTel shutdown; this orchestrator owns Phase 3 substrate
 * teardown in the order documented in 03-CONTEXT.md: tenantPool.drain →
 * redis.quit → pg.end. pkce-store and kek have no runtime shutdown — Redis
 * TTL handles PKCE entries, and the KEK buffer is statically bound.
 *
 * The `region:phase3-shutdown-*` markers create the same disjoint-edit
 * contract as the startup anchors: sibling plans fill their own region only.
 */
async function phase3ShutdownOrchestrator(): Promise<void> {
  try {
    // region:phase3-shutdown-tenant-pool (filled by 03-05)
    // endregion:phase3-shutdown-tenant-pool

    // region:phase3-shutdown-redis       (filled by 03-02)
    // endregion:phase3-shutdown-redis

    // region:phase3-shutdown-postgres    (filled by 03-01 Task 2 — THIS plan)
    await postgres.shutdown();
    // endregion:phase3-shutdown-postgres
  } catch (err) {
    // Shutdown errors must not throw out of the signal handler — swallow
    // and log so the Phase 1 shutdown handler can still exit cleanly.
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      'phase3ShutdownOrchestrator: error during teardown (non-fatal)'
    );
  }
}

async function main(): Promise<void> {
  try {
    const args = parseArgs();

    // --health-check short-circuit for Docker HEALTHCHECK (OPS-03).
    // MUST run BEFORE AuthManager creation or secrets loading — the probe is
    // invoked every 30s and must stay cheap. It also MUST exit before any
    // side-effectful startup (MSAL, secrets, logger file IO) so a broken
    // config cannot cause the probe to hang or fail spuriously.
    if (args.healthCheck) {
      const exitCode = await runHealthCheck(args);
      process.exit(exitCode);
    }

    // Fail-fast validation for production HTTP-mode config (plan 01-07 /
    // D-02). MUST run AFTER the --health-check short-circuit (so the probe
    // stays cheap on healthy containers) but BEFORE any MSAL / secrets /
    // server bootstrapping (so a misconfigured deployment exits cleanly
    // without allocating resources). Stdio mode + dev mode are permissive.
    validateProdHttpConfig(args);

    // Register graceful-shutdown hooks early (plan 01-05 / OPS-09). In stdio
    // mode the null server skips server.close() but still flushes pino +
    // OTel on Ctrl-C. In HTTP mode this call is a pre-listen safety net —
    // src/server.ts re-registers with the real http.Server once app.listen
    // returns, and registerShutdownHooks's removeAllListeners guard makes
    // that later registration win.
    registerShutdownHooks(null, logger);

    const includeWorkScopes = args.orgMode || false;
    if (includeWorkScopes) {
      logger.info('Organization mode enabled - including work account scopes');
    }

    const readOnly = args.readOnly || false;
    const scopes = buildScopesFromEndpoints(includeWorkScopes, args.enabledTools, readOnly);

    if (args.listPermissions) {
      const sorted = [...scopes].sort((a, b) => a.localeCompare(b));
      const mode = includeWorkScopes ? 'org' : 'personal';
      const filter = args.enabledTools ? args.enabledTools : undefined;
      console.log(JSON.stringify({ mode, readOnly, filter, permissions: sorted }, null, 2));
      process.exit(0);
    }

    // ── Phase 3 bootstrap scaffolding (plan 03-01 Task 2) ─────────────────
    // The `region:phase3-*` markers below create a disjoint edit contract
    // for the sibling wave-2/3 plans (03-02, 03-03, 03-04, 03-05). Each
    // sibling plan's Task 2 edits ONLY inside its own region; surrounding
    // bootstrap code is off-limits. The marker comments are LOAD-BEARING —
    // do not delete them. grep counts must remain exactly 2 per name.
    //
    // Startup order (per 03-CONTEXT.md): postgres → redis → kek → pkce-store
    // → tenant-pool. Only HTTP mode needs these substrates; stdio reuses the
    // file-backed token cache + in-memory PKCE per D-04.
    const isHttpMode = Boolean(args.http);
    const readinessChecks: ReadinessCheck[] = [];

    // region:phase3-postgres  (filled by 03-01 Task 2 — THIS plan)
    // Plan 03-01: Postgres bootstrap — runs BEFORE Redis (03-02), migrations (03-01 bin/migrate),
    // tenant-pool (03-05), transports (03-09).
    if (isHttpMode) {
      postgres.getPool(); // throws fast if env missing
      readinessChecks.push(postgres.readinessCheck);
    }
    // endregion:phase3-postgres

    // region:phase3-redis       (filled by 03-02 Task 2)
    // endregion:phase3-redis

    // region:phase3-kek         (filled by 03-04 Task 2)
    // endregion:phase3-kek

    // region:phase3-pkce-store  (filled by 03-03 Task 2)
    // endregion:phase3-pkce-store

    // region:phase3-tenant-pool (filled by 03-05 Task 2/3)
    // endregion:phase3-tenant-pool

    const authManager = await AuthManager.create(scopes);
    await authManager.loadTokenCache();

    if (args.authBrowser) {
      authManager.setUseInteractiveAuth(true);
      logger.info('Browser-based interactive auth enabled');
    }

    if (args.login) {
      if (args.authBrowser) {
        await authManager.acquireTokenInteractive();
      } else {
        await authManager.acquireTokenByDeviceCode();
      }
      logger.info('Login completed, testing connection with Graph API...');
      const result = await authManager.testLogin();
      console.log(JSON.stringify(result));
      process.exit(0);
    }

    if (args.verifyLogin) {
      logger.info('Verifying login...');
      const result = await authManager.testLogin();
      console.log(JSON.stringify(result));
      process.exit(0);
    }

    if (args.logout) {
      await authManager.logout();
      console.log(JSON.stringify({ message: 'Logged out successfully' }));
      process.exit(0);
    }

    if (args.listAccounts) {
      const accounts = await authManager.listAccounts();
      const selectedAccountId = authManager.getSelectedAccountId();
      const result = accounts.map((account) => ({
        id: account.homeAccountId,
        username: account.username,
        name: account.name,
        selected: account.homeAccountId === selectedAccountId,
      }));
      console.log(JSON.stringify({ accounts: result }));
      process.exit(0);
    }

    if (args.selectAccount) {
      const success = await authManager.selectAccount(args.selectAccount);
      if (success) {
        console.log(JSON.stringify({ message: `Selected account: ${args.selectAccount}` }));
      } else {
        console.log(JSON.stringify({ error: `Account not found: ${args.selectAccount}` }));
        process.exit(1);
      }
      process.exit(0);
    }

    if (args.removeAccount) {
      const success = await authManager.removeAccount(args.removeAccount);
      if (success) {
        console.log(JSON.stringify({ message: `Removed account: ${args.removeAccount}` }));
      } else {
        console.log(JSON.stringify({ error: `Account not found: ${args.removeAccount}` }));
        process.exit(1);
      }
      process.exit(0);
    }

    // Advisory probe for v1 OS-keychain leftovers (SECUR-07 / D-04). Stdio
    // only; skipped when the file cache already exists. Runs AFTER auth
    // bootstrap so we've already confirmed tokens would have loaded from
    // the file cache — if we got here without tokens, the probe can tell
    // the user how to migrate them.
    maybeProbeKeytarLeftovers(args);

    const server = new MicrosoftGraphServer(authManager, args, readinessChecks);
    await server.initialize(version);
    await server.start();

    // Phase 3 (plan 03-01 Task 2) — register a secondary SIGTERM/SIGINT
    // handler AFTER server.start() so it stacks on top of the handler
    // installed inside server.start() by registerShutdownHooks(). Both
    // handlers fire in parallel; registering here means no later
    // `removeAllListeners` call wipes ours. Per 03-CONTEXT graceful-shutdown
    // order: tenantPool.drain → redis.quit → pg.end → (pino flush + OTel
    // shutdown handled by shutdown.ts).
    if (isHttpMode) {
      const invokePhase3Shutdown = (): void => {
        void phase3ShutdownOrchestrator();
      };
      process.on('SIGTERM', invokePhase3Shutdown);
      process.on('SIGINT', invokePhase3Shutdown);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    logger.error(`Startup error: ${message}`);
    console.error(stack ?? message);
    process.exit(1);
  }
}

main();
