/**
 * Shared testcontainers-postgresql harness (plan 03-01 Task 3, Wave 0).
 *
 * Boots a single Postgres container per vitest process and reuses it
 * across test files to amortise the ~30s cold-start. Unit tests that use
 * pg-mem do NOT call this — reserve it for integration tests that need a
 * real Postgres (e.g., 03-05 tenant-pool, 03-10 audit writer).
 *
 * Usage:
 *   import { startPgContainer } from '../setup/testcontainers';
 *   const env = await startPgContainer();
 *   const pool = new Pool({ connectionString: env.pgUrl });
 *   ...
 *   await env.cleanup(); // in afterAll
 *
 * Environment gate: integration tests should guard on a feature flag
 * (e.g., `MS365_MCP_INTEGRATION=1`) so CI can run the unit suite fast
 * without Docker. The helper below does not impose the gate — callers
 * decide when to start the container.
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

export interface IntegrationPgEnv {
  /** Full libpq connection string — pg.Pool + node-pg-migrate both accept it. */
  pgUrl: string;
  /** Stops the container. Subsequent startPgContainer() calls re-cold-start. */
  cleanup: () => Promise<void>;
}

let cached: { env: IntegrationPgEnv; container: StartedPostgreSqlContainer } | null = null;

/**
 * Start (or reuse the cached) Postgres container. Returns the same
 * connection URL on every call until cleanup() is invoked.
 */
export async function startPgContainer(): Promise<IntegrationPgEnv> {
  if (cached) return cached.env;
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withUsername('mcp')
    .withPassword('mcp')
    .withDatabase('mcp')
    .start();
  const env: IntegrationPgEnv = {
    pgUrl: container.getConnectionUri(),
    cleanup: async () => {
      try {
        await container.stop();
      } finally {
        cached = null;
      }
    },
  };
  cached = { env, container };
  return env;
}
