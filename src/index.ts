#!/usr/bin/env node
import './lib/otel.js'; // MUST be first import — registers OTel instrumentation hooks before anything else loads
// Note: OTel reads OTEL_EXPORTER_OTLP_ENDPOINT from process.env at SDK start time.
// This MUST run BEFORE dotenv/config so that in production the env var comes from
// the real environment (systemd / Docker / CI), not from .env.
import 'dotenv/config';
import http from 'node:http';
import { parseArgs, type CommandOptions } from './cli.js';
import logger from './logger.js';
import AuthManager, { buildScopesFromEndpoints } from './auth.js';
import MicrosoftGraphServer, { parseHttpOption } from './server.js';
import { registerShutdownHooks } from './lib/shutdown.js';
import { version } from './version.js';

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

    const server = new MicrosoftGraphServer(authManager, args);
    await server.initialize(version);
    await server.start();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Startup error: ${message}`);
    console.error(message);
    process.exit(1);
  }
}

main();
