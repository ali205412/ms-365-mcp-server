#!/usr/bin/env node
/**
 * node-pg-migrate CLI wrapper (plan 03-01).
 *
 * Subcommands:
 *   - migrate up [--dry-run]   apply pending migrations
 *   - migrate down [--count=1] roll back N migrations
 *   - migrate status           print applied vs pending
 *
 * Auto-run on container startup via docker-entrypoint.sh — kill-switch
 * MS365_MCP_MIGRATE_ON_STARTUP=0 for ops who prefer manual control.
 *
 * Module design (bin/migrate-tokens.mjs:27-30 pattern): export `main` so
 * tests can invoke it programmatically; entry-point check at the bottom
 * runs main() only when invoked as a script.
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import { runner as migrationRunner } from 'node-pg-migrate';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'migrations');
const { Client } = pg;
const VALID_COMMANDS = new Set(['up', 'down', 'status']);

export function parseCommand(cmd = 'up') {
  if (!VALID_COMMANDS.has(cmd)) {
    throw new Error(`Invalid migrate command "${cmd}" (expected up, down, or status)`);
  }
  return cmd;
}

/**
 * Parse an integer CLI flag like `--count=3`. Returns Infinity when the
 * flag is absent (run-all-pending semantics) and NaN when the caller
 * supplied a non-numeric value (main() rejects).
 */
export function parseCount(rest, cmd = 'up') {
  const arg = rest.find((a) => typeof a === 'string' && a.startsWith('--count='));
  if (!arg) return cmd === 'down' ? 1 : Infinity;
  const raw = arg.slice('--count='.length);
  if (!/^[1-9]\d*$/.test(raw)) return NaN;
  return Number.parseInt(raw, 10);
}

function pgvectorEnabledFromEnv() {
  return (
    process.env.MS365_MCP_PGVECTOR_ENABLED === '1' ||
    process.env.MS365_MCP_PGVECTOR_ENABLED === 'true'
  );
}

async function createMigrationClient(connectionString) {
  const client = new Client({ connectionString });
  await client.connect();
  await client.query("SELECT set_config('ms365_mcp.pgvector_enabled', $1, false)", [
    pgvectorEnabledFromEnv() ? 'true' : 'false',
  ]);
  return client;
}

async function applyPgvectorSupport(client) {
  if (!pgvectorEnabledFromEnv()) return;

  const { rows } = await client.query(`
    SELECT
      EXISTS (
        SELECT 1
        FROM pg_available_extensions
        WHERE name = 'vector'
      ) AS extension_available,
      to_regclass('public.tenant_facts') IS NOT NULL AS table_exists
  `);
  const status = rows[0] ?? {};
  if (!status.table_exists) return;
  if (!status.extension_available) {
    process.stderr.write(
      'MS365_MCP_PGVECTOR_ENABLED is set, but the vector extension is not available; skipping tenant_facts.embedding setup\n'
    );
    return;
  }

  await client.query('CREATE EXTENSION IF NOT EXISTS vector');
  await client.query('ALTER TABLE tenant_facts ADD COLUMN IF NOT EXISTS embedding vector(1536)');
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_tenant_facts_embedding
      ON tenant_facts
      USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100)
  `);
}

/**
 * Programmatic entry point. Returns 0 on success, non-zero on error so
 * callers can choose whether to `process.exit()`.
 *
 * @param {string[]} [argv] - Defaults to process.argv.slice(2) for CLI use.
 * @returns {Promise<number>}
 */
export async function main(argv = process.argv.slice(2)) {
  const [rawCmd = 'up', ...rest] = argv;
  const cmd = parseCommand(rawCmd);
  const dryRun = rest.includes('--dry-run');
  const connectionString = process.env.MS365_MCP_DATABASE_URL;
  if (!connectionString) {
    throw new Error('MS365_MCP_DATABASE_URL required for migrations');
  }

  const count = parseCount(rest, cmd);
  if (Number.isNaN(count)) {
    throw new Error('--count= must be a positive integer');
  }

  const client = await createMigrationClient(connectionString);
  try {
    const baseOpts = {
      dbClient: client,
      dir: MIGRATIONS_DIR,
      migrationsTable: 'pgmigrations',
      checkOrder: true,
      verbose: false,
      logger: {
        info: () => {},
        warn: (msg) => process.stderr.write(`${msg}\n`),
        error: (msg) => process.stderr.write(`${msg}\n`),
        debug: () => {},
      },
    };

    if (cmd === 'status') {
      // node-pg-migrate doesn't expose a status-only API; use dryRun+up to
      // enumerate what WOULD run. `count` defaults to Infinity so we see the
      // full set of pending migrations, not just the first one.
      const pending = await migrationRunner({
        ...baseOpts,
        direction: 'up',
        count: Infinity,
        dryRun: true,
      });
      process.stdout.write(`${JSON.stringify({ pending: pending.length }, null, 2)}\n`);
      return 0;
    }

    const direction = cmd === 'down' ? 'down' : 'up';
    const applied = await migrationRunner({
      ...baseOpts,
      direction,
      count,
      dryRun,
    });
    if (direction === 'up' && !dryRun) {
      await applyPgvectorSupport(client);
    }
    process.stdout.write(
      `${JSON.stringify({ direction, count: applied.length, dryRun }, null, 2)}\n`
    );
    return 0;
  } finally {
    await client.end();
  }
}

const invokedAsScript = (() => {
  try {
    const argv1 = process.argv[1];
    if (!argv1) return false;
    return import.meta.url === pathToFileURL(argv1).href;
  } catch {
    return false;
  }
})();

if (invokedAsScript) {
  main()
    .then((code) => process.exit(code ?? 0))
    .catch((err) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
}
