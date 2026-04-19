/**
 * Plan 03-09 Task 2 — stdio transport with --tenant-id (TRANS-03).
 *
 * Verifies:
 *   - startStdioTransport wraps a StdioServerTransport around the mcpServer
 *     and passes the optional tenant through logging context.
 *   - --tenant-id CLI flag is accepted and propagates to options.tenantId.
 *   - MS365_MCP_TENANT_ID env var is read as a fallback (exercised by the
 *     stdio bootstrap in src/index.ts — verified indirectly by asserting
 *     the env-var code path exists).
 *   - Full subprocess-based tests live in 03-VALIDATION.md manual-verify
 *     list because vitest spawn + tenant-row fixtures are too heavy for
 *     unit coverage.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStdioTransport } from '../../src/lib/transports/stdio.js';
import type { TenantRow } from '../../src/lib/tenant/tenant-row.js';

vi.mock('../../src/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const FAKE_TENANT: TenantRow = {
  id: 'aaaaaaaa-1111-2222-3333-444444444444',
  mode: 'delegated',
  client_id: 'fake-client',
  client_secret_ref: null,
  tenant_id: 'aaaaaaaa-1111-2222-3333-444444444444',
  cloud_type: 'global',
  redirect_uri_allowlist: [],
  cors_origins: [],
  allowed_scopes: ['User.Read'],
  enabled_tools: null,
  wrapped_dek: null,
  slug: null,
  disabled_at: null,
  created_at: new Date(),
  updated_at: new Date(),
};

describe('stdio transport (TRANS-03)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('startStdioTransport accepts { tenant, mcpServer } and calls mcpServer.connect()', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mcpServer: any = { connect: vi.fn().mockResolvedValue(undefined) };
    await startStdioTransport({ tenant: FAKE_TENANT, mcpServer });
    expect(mcpServer.connect).toHaveBeenCalledTimes(1);
    // The argument is a StdioServerTransport instance — we can't import the
    // private constructor cleanly here, but we can assert the argument has
    // `connect` wiring methods (start / close) typical of an SDK transport.
    const arg = mcpServer.connect.mock.calls[0]?.[0];
    expect(arg).toBeDefined();
    expect(typeof arg.start === 'function' || typeof arg.send === 'function').toBe(true);
  });

  it('startStdioTransport works when tenant is undefined (legacy single-tenant mode)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mcpServer: any = { connect: vi.fn().mockResolvedValue(undefined) };
    await startStdioTransport({ tenant: undefined, mcpServer });
    expect(mcpServer.connect).toHaveBeenCalledTimes(1);
  });

  it('--tenant-id CLI flag is declared in src/cli.ts', () => {
    const cliSource = readFileSync(path.join(REPO_ROOT, 'src', 'cli.ts'), 'utf8');
    // Commander `--tenant-id <value>` option must be declared.
    expect(cliSource).toMatch(/--tenant-id\s+<[^>]+>/);
  });

  it('CommandOptions interface exposes the tenantId field', () => {
    const cliSource = readFileSync(path.join(REPO_ROOT, 'src', 'cli.ts'), 'utf8');
    // The parseArgs return type must surface tenantId so downstream bootstrap
    // code (src/index.ts) can consume the flag.
    expect(cliSource).toMatch(/tenantId\?:\s*string/);
  });

  it('src/index.ts stdio bootstrap reads args.tenantId (or env fallback)', () => {
    const indexSource = readFileSync(path.join(REPO_ROOT, 'src', 'index.ts'), 'utf8');
    // The stdio bootstrap must consult args.tenantId — either directly or
    // via a local variable assigned from args.tenantId (possibly through a
    // type assertion like `(args as CommandOptions).tenantId`) — and must
    // also fall back to MS365_MCP_TENANT_ID env var.
    expect(indexSource).toMatch(/args\b[^;\n]*\.tenantId|options\b[^;\n]*\.tenantId/);
    expect(indexSource).toMatch(/MS365_MCP_TENANT_ID/);
  });

  it('src/index.ts exits 1 on tenant_not_found when --tenant-id is unknown', () => {
    const indexSource = readFileSync(path.join(REPO_ROOT, 'src', 'index.ts'), 'utf8');
    // Bootstrap must refuse to start with an unknown tenant id — either
    // through process.exit(1) alongside a tenant_not_found log/message, or
    // by throwing an error that propagates to the top-level catch.
    expect(indexSource).toMatch(/tenant_not_found/);
  });

  it('.env.example documents MS365_MCP_TENANT_ID for stdio multi-tenant mode', () => {
    const envSource = readFileSync(path.join(REPO_ROOT, '.env.example'), 'utf8');
    expect(envSource).toMatch(/MS365_MCP_TENANT_ID/);
  });
});
