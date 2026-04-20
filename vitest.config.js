import { defineConfig } from 'vitest/config';

// Integration tests (*.int.test.* + test/integration/**) require Postgres,
// Redis, or real MSAL/OAuth state that unit tests shouldn't assume. They
// are opted-in via MS365_MCP_INTEGRATION=1 so the default `npm test`
// surface stays fast and hermetic. CI pipelines that start the real
// services run `MS365_MCP_INTEGRATION=1 npm test` (or `npm run test:int`).
const RUN_INTEGRATION = process.env.MS365_MCP_INTEGRATION === '1';

const INTEGRATION_PATTERNS = [
  '**/*.int.test.*',
  'test/integration/**/*.test.*',
  // Legacy plan-03 tests that boot the server and exercise Redis-backed
  // token storage end-to-end. Moved here rather than renamed to keep
  // git blame clean.
  'test/token-endpoint.test.ts',
];

// The generated Microsoft Graph client under src/generated/client.ts is
// ~46 MB and is transitively imported by most server-level tests
// (src/server.ts -> src/graph-tools.ts -> src/generated/client.ts). Each
// vitest fork must be big enough to keep it in memory + run its own
// test setup; 8 GB is the empirical floor discovered while stabilising
// Phase 5's regenerated client.
const HEAP_MB = 12288;

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', ...(RUN_INTEGRATION ? [] : INTEGRATION_PATTERNS)],
    // Threads share a single V8 isolate (one parse of the 46 MB client)
    // across many test files, where forks + isolate:true would re-parse
    // in each new VM context and drive RSS past the kernel OOM threshold.
    // Tradeoff: native add-ons that can't run in workers aren't used in
    // this codebase (keytar was removed in plan 01-08), so threads are
    // safe. `singleThread: true` serialises files within one long-lived
    // thread — deterministic ordering, bounded memory, cold-import paid
    // exactly once.
    pool: 'threads',
    fileParallelism: false,
    poolOptions: {
      threads: {
        singleThread: true,
        // Worker threads inherit the parent's heap limit from NODE_OPTIONS
        // (see npm scripts); worker_threads rejects --max-old-space-size
        // in execArgv directly (ERR_WORKER_INVALID_EXEC_ARGV).
      },
    },
    // Per-file isolation (fresh VM context + module registry). Required
    // because many tests use top-level `vi.mock('../../src/logger.js')`
    // and similar hoisted mocks — those leak across files under
    // `isolate: false` and produce false failures. Memory pressure from
    // re-parsing src/generated/client.ts per file is absorbed by the 8 GB
    // execArgv above; see `HEAP_MB`.
    isolate: true,
    // The cold-import cost of src/generated/client.ts (tsx transform on a
    // 46 MB file) can push the first test that lands on a fresh VM context
    // past the default 5 s timeout. Middleware tests that dynamic-import
    // tenant / registry modules are the usual victim — they pay the parse
    // cost + the await round-trip before any assertion. 45 s is
    // comfortably over the observed cold-import wall time.
    testTimeout: 45_000,
    hookTimeout: 45_000,
  },
});
