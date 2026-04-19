#!/usr/bin/env node
/**
 * Operator CLI: insert a tenant row (plan 03-01).
 *
 * Usage:
 *   node bin/create-tenant.mjs \
 *     --id=<guid> \
 *     --client-id=<guid> \
 *     --tenant-id=<guid> \
 *     --mode=<delegated|app-only|bearer> \
 *     [--slug=<text>] \
 *     [--cloud-type=global|china]
 *
 * Plan 03-01 stores `wrapped_dek=NULL` — DEK generation lives in 03-04 and
 * must be applied before this tenant can serve requests. A warning is
 * logged on every insert so operators see the gap.
 *
 * Idempotency: duplicate `--id=<guid>` rejects with `tenant_already_exists`
 * rather than silently swallowing the error. Operators can re-run with a
 * different id or use the 03-04 mint flow.
 *
 * Module design: exported `main(argv)` for programmatic test invocation;
 * entry-point check runs main() only when invoked as a script (mirrors
 * bin/migrate-tokens.mjs:243-263).
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const VALID_MODES = new Set(['delegated', 'app-only', 'bearer']);
const VALID_CLOUDS = new Set(['global', 'china']);

/**
 * Extract a `--key=value` flag from the argv list. Returns undefined when
 * missing. For boolean-style `--flag` with no value, use `.has(flag)`.
 */
function getFlag(argv, name) {
  const prefix = `--${name}=`;
  const match = argv.find((a) => typeof a === 'string' && a.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

/**
 * Programmatic entry point. Accepts an optional pg.Pool (tests inject
 * pg-mem). Production uses the singleton from src/lib/postgres.ts (via the
 * compiled dist/ output).
 *
 * @param {string[]} argv
 * @param {{ pool?: import('pg').Pool, logger?: { warn: (msg: string) => void } }} [deps]
 * @returns {Promise<{ id: string }>}
 */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const id = getFlag(argv, 'id') ?? randomUUID();
  const clientId = getFlag(argv, 'client-id');
  const tenantId = getFlag(argv, 'tenant-id');
  const mode = getFlag(argv, 'mode');
  const slug = getFlag(argv, 'slug') ?? null;
  const cloudType = getFlag(argv, 'cloud-type') ?? 'global';

  if (!clientId) throw new Error('--client-id=<guid> is required');
  if (!tenantId) throw new Error('--tenant-id=<guid> is required');
  if (!mode) throw new Error('--mode=<delegated|app-only|bearer> is required');
  if (!VALID_MODES.has(mode)) {
    throw new Error(`invalid --mode=${mode}; must be one of ${[...VALID_MODES].join(',')}`);
  }
  if (!VALID_CLOUDS.has(cloudType)) {
    throw new Error(`invalid --cloud-type=${cloudType}; must be one of ${[...VALID_CLOUDS].join(',')}`);
  }

  const pool = deps.pool ?? (await getProdPool());
  const warn = deps.logger?.warn ?? ((m) => process.stderr.write(`${m}\n`));

  // Duplicate id check is deliberate (not a plain INSERT ... ON CONFLICT):
  // operators creating tenants should see a clear failure rather than a
  // silent overwrite. 03-04's mint flow uses UPDATE for the DEK wrap.
  const existing = await pool.query('SELECT id FROM tenants WHERE id = $1', [id]);
  if (existing.rows.length > 0) {
    throw new Error(`tenant_already_exists: ${id}`);
  }

  await pool.query(
    `INSERT INTO tenants (id, mode, client_id, tenant_id, cloud_type, slug, wrapped_dek)
       VALUES ($1, $2, $3, $4, $5, $6, NULL)`,
    [id, mode, clientId, tenantId, cloudType, slug]
  );

  warn(
    `Tenant ${id} created with wrapped_dek=NULL — plan 03-04 must be applied before this tenant can serve requests`
  );

  return { id };
}

/**
 * Lazy-import the compiled pg pool so this script works without an
 * explicit `npm run build` in local dev — we fall back to the TypeScript
 * source via tsx when the compiled dist/ is absent. Tests inject a Pool
 * directly via the `deps.pool` option.
 */
async function getProdPool() {
  try {
    const mod = await import('../dist/lib/postgres.js');
    return mod.getPool();
  } catch {
    // Fallback: dev environments may invoke the CLI before `npm run build`.
    // We throw a helpful message rather than silently failing.
    throw new Error(
      'dist/lib/postgres.js not found — run `npm run build` before invoking bin/create-tenant.mjs'
    );
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
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      process.exit(0);
    })
    .catch((err) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
}

void fileURLToPath; // avoid "unused" lint if reordering imports later
