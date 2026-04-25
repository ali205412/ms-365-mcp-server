#!/usr/bin/env node
/**
 * Operator CLI: opt an existing tenant into the Phase 7 discovery-v1 surface.
 *
 * Usage:
 *   node bin/migrate-tenant-to-discovery.mjs --tenant-id <uuid> [--dry-run]
 *
 * The migration is deliberately opt-in: it updates only the target tenant's
 * preset_version, never mutates enabled_tools, and publishes cache/list
 * invalidations only after the Postgres transaction commits.
 */
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TENANT_GUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DISCOVERY_PRESET_VERSION = 'discovery-v1';

function getFlag(argv, name) {
  const eqPrefix = `--${name}=`;
  const eq = argv.find((arg) => typeof arg === 'string' && arg.startsWith(eqPrefix));
  if (eq) return eq.slice(eqPrefix.length);

  const idx = argv.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  const value = argv[idx + 1];
  return typeof value === 'string' && !value.startsWith('--') ? value : undefined;
}

function hasFlag(argv, name) {
  return argv.includes(`--${name}`);
}

async function loadProdPostgres() {
  try {
    return await import('../dist/lib/postgres.js');
  } catch {
    throw new Error(
      'dist/lib/postgres.js not found — run `npm run build` before invoking bin/migrate-tenant-to-discovery.mjs'
    );
  }
}

async function loadProdRedis() {
  try {
    return await import('../dist/lib/redis.js');
  } catch {
    throw new Error(
      'dist/lib/redis.js not found — run `npm run build` before invoking bin/migrate-tenant-to-discovery.mjs'
    );
  }
}

async function loadPublishers() {
  try {
    const tenant = await import('../dist/lib/tenant/tenant-invalidation.js');
    const selection = await import('../dist/lib/tool-selection/tool-selection-invalidation.js');
    const events = await import('../dist/lib/mcp-notifications/events.js');
    return {
      publishTenantInvalidation: tenant.publishTenantInvalidation,
      publishToolSelectionInvalidation: selection.publishToolSelectionInvalidation,
      publishToolsListChanged: events.publishToolsListChanged,
    };
  } catch {
    const tenant = await import('../src/lib/tenant/tenant-invalidation.ts');
    const selection = await import('../src/lib/tool-selection/tool-selection-invalidation.ts');
    const events = await import('../src/lib/mcp-notifications/events.ts');
    return {
      publishTenantInvalidation: tenant.publishTenantInvalidation,
      publishToolSelectionInvalidation: selection.publishToolSelectionInvalidation,
      publishToolsListChanged: events.publishToolsListChanged,
    };
  }
}

async function loadAuditWriter() {
  try {
    const mod = await import('../dist/lib/audit.js');
    return mod.writeAudit;
  } catch {
    const mod = await import('../src/lib/audit.ts');
    return mod.writeAudit;
  }
}

async function getProdPool() {
  const postgres = await loadProdPostgres();
  return postgres.getPool();
}

async function getProdRedis() {
  const redis = await loadProdRedis();
  return redis.getRedis();
}

function rowToPreview(row, presetVersion = row.preset_version) {
  return {
    id: row.id,
    mode: row.mode,
    preset_version: presetVersion,
    enabled_tools: row.enabled_tools ?? null,
  };
}

async function seedStarterBookmarks(client, tenantId) {
  const { rows } = await client.query(
    `SELECT alias, MAX(ts) AS last_seen
     FROM (
       SELECT COALESCE(meta->>'toolAlias', meta->>'alias', target) AS alias, ts
       FROM audit_log
       WHERE tenant_id = $1
     ) recent_aliases
     WHERE alias IS NOT NULL
     GROUP BY alias
     ORDER BY last_seen DESC, alias ASC
     LIMIT 10`,
    [tenantId]
  );

  let inserted = 0;
  for (const row of rows) {
    if (!row.alias || row.alias === '') continue;
    const result = await client.query(
      `INSERT INTO tenant_tool_bookmarks (id, tenant_id, alias, label, note)
       VALUES ($1, $2, $3, $3, 'Seeded during discovery-v1 migration')
       ON CONFLICT (tenant_id, alias) DO NOTHING
       RETURNING alias`,
      [randomUUID(), tenantId, row.alias]
    );
    inserted += result.rows.length;
  }
  return inserted;
}

async function runInTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original error.
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Programmatic entry point. Tests inject pool/redis/publishers; production
 * uses compiled dist modules.
 *
 * @param {string[]} argv
 * @param {{
 *   pool?: import('pg').Pool,
 *   redis?: { publish: (channel: string, message: string) => Promise<number> },
 *   publishers?: {
 *     publishTenantInvalidation: Function,
 *     publishToolSelectionInvalidation: Function,
 *     publishToolsListChanged: Function,
 *   },
 *   writeAudit?: Function,
 * }} [deps]
 */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const tenantId = getFlag(argv, 'tenant-id');
  const dryRun = hasFlag(argv, 'dry-run');

  if (!tenantId) {
    throw new Error('Usage: migrate-tenant-to-discovery --tenant-id <uuid> [--dry-run]');
  }
  if (!TENANT_GUID_REGEX.test(tenantId)) {
    throw new Error(`invalid --tenant-id=${tenantId}; expected canonical UUID`);
  }

  const pool = deps.pool ?? (await getProdPool());

  if (dryRun) {
    const { rows } = await pool.query(
      'SELECT id, mode, preset_version, enabled_tools FROM tenants WHERE id = $1',
      [tenantId]
    );
    if (rows.length === 0) {
      throw new Error(`tenant_not_found: ${tenantId}`);
    }
    const before = rowToPreview(rows[0]);
    return {
      dryRun: true,
      before,
      after: rowToPreview(rows[0], DISCOVERY_PRESET_VERSION),
    };
  }

  const writeAudit = deps.writeAudit ?? (await loadAuditWriter());
  const txResult = await runInTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `UPDATE tenants
       SET preset_version = 'discovery-v1', updated_at = NOW()
       WHERE id = $1
       RETURNING id, mode, preset_version`,
      [tenantId]
    );
    if (rows.length === 0) {
      throw new Error(`tenant_not_found: ${tenantId}`);
    }

    const bookmarksSeeded = await seedStarterBookmarks(client, tenantId);
    await writeAudit(client, {
      tenantId,
      actor: 'cli',
      action: 'tenant.discovery-migrate',
      target: tenantId,
      ip: null,
      requestId: `cli-${randomUUID()}`,
      result: 'success',
      meta: {
        presetVersion: DISCOVERY_PRESET_VERSION,
        bookmarksSeeded,
      },
    });

    return {
      dryRun: false,
      updated: rows[0],
      bookmarksSeeded,
    };
  });

  const redis = deps.redis ?? (await getProdRedis());
  const publishers = deps.publishers ?? (await loadPublishers());
  await publishers.publishTenantInvalidation(redis, tenantId);
  await publishers.publishToolSelectionInvalidation(redis, tenantId, 'discovery-migration');
  await publishers.publishToolsListChanged(redis, tenantId, 'discovery-migration');

  return txResult;
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

void fileURLToPath;
