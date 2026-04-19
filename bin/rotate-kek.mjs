#!/usr/bin/env node
/**
 * Operator CLI: rotate the KEK by rewrapping every tenant DEK (plan 03-04, D-12).
 *
 * Usage:
 *   node bin/rotate-kek.mjs --old=<base64-32-bytes> --new=<base64-32-bytes>
 *
 * Procedure (D-12 manual quarterly rotation):
 *   1. Unwrap each tenant's `wrapped_dek` with the old KEK.
 *   2. Re-wrap with the new KEK.
 *   3. UPDATE tenants SET wrapped_dek = <new_envelope>, updated_at = NOW().
 *
 * Transactional per row. Tenants whose wrapped_dek fails to unwrap with the
 * old KEK (because they were already rotated, or the row is a disabled
 * cryptoshred placeholder) are silently skipped and counted in `skipped`.
 * Rows with wrapped_dek = NULL are skipped without even attempting unwrap.
 *
 * Run during a maintenance window. After completion, the operator updates
 * MS365_MCP_KEK and restarts the server. During the rewrap window,
 * MS365_MCP_KEK_PREVIOUS may be set (reserved for 03-05 dual-KEK acquire).
 *
 * Module design: exported `main(argv, deps?)` for programmatic test
 * invocation — tests inject a pg-mem pool via `deps.pool`. Entry-point check
 * at the bottom runs main() only when invoked as a script.
 */
import { fileURLToPath, pathToFileURL } from 'node:url';

const KEY_LENGTH = 32;

/**
 * Lazy-load the envelope module. Tests (vitest + tsx) resolve the TypeScript
 * source via the alternate path; production invocation (`node bin/...`)
 * resolves the compiled dist.
 */
async function loadEnvelope() {
  try {
    return await import('../dist/lib/crypto/envelope.js');
  } catch {
    try {
      return await import('../src/lib/crypto/envelope.ts');
    } catch {
      throw new Error(
        'neither dist/lib/crypto/envelope.js nor src/lib/crypto/envelope.ts could be loaded — run `npm run build` first'
      );
    }
  }
}

/**
 * Lazy-load the production pg pool. Tests inject `deps.pool` directly.
 */
async function getProdPool() {
  try {
    const mod = await import('../dist/lib/postgres.js');
    return mod.getPool();
  } catch {
    throw new Error(
      'dist/lib/postgres.js not found — run `npm run build` before invoking bin/rotate-kek.mjs'
    );
  }
}

/**
 * Extract a `--key=value` flag. Returns undefined when missing.
 */
function getFlag(argv, name) {
  const prefix = `--${name}=`;
  const match = argv.find((a) => typeof a === 'string' && a.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

function parseKeyArg(b64, label) {
  if (!b64) {
    throw new Error(`--${label}=<base64-32-bytes> is required`);
  }
  const buf = Buffer.from(b64, 'base64');
  if (buf.length !== KEY_LENGTH) {
    throw new Error(`--${label} must decode to exactly 32 bytes (got ${buf.length})`);
  }
  return buf;
}

/**
 * Programmatic entry point. Accepts injected deps for tests.
 *
 * @param {string[]} argv
 * @param {{ pool?: import('pg').Pool }} [deps]
 * @returns {Promise<{ rewrapped: number, skipped: number }>}
 */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const oldB64 = getFlag(argv, 'old');
  const newB64 = getFlag(argv, 'new');
  const oldKek = parseKeyArg(oldB64, 'old');
  const newKek = parseKeyArg(newB64, 'new');

  const { wrapDek, unwrapDek } = await loadEnvelope();

  const pool = deps.pool ?? (await getProdPool());
  const ownsPool = !deps.pool;

  let rewrapped = 0;
  let skipped = 0;

  try {
    const { rows } = await pool.query(
      'SELECT id, wrapped_dek FROM tenants WHERE wrapped_dek IS NOT NULL'
    );

    for (const row of rows) {
      const envelope =
        typeof row.wrapped_dek === 'string' ? JSON.parse(row.wrapped_dek) : row.wrapped_dek;

      let plaintextDek;
      try {
        plaintextDek = unwrapDek(envelope, oldKek);
      } catch {
        // Already rotated, cryptoshred placeholder, or the old KEK is wrong.
        skipped++;
        continue;
      }

      const newEnvelope = wrapDek(plaintextDek, newKek);
      await pool.query(
        'UPDATE tenants SET wrapped_dek = $1::jsonb, updated_at = NOW() WHERE id = $2',
        [JSON.stringify(newEnvelope), row.id]
      );
      rewrapped++;
    }

    return { rewrapped, skipped };
  } finally {
    if (ownsPool) await pool.end();
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
