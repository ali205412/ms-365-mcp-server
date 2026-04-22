import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/**/*.ts', 'src/endpoints.json'],
  format: ['esm'],
  target: 'es2020',
  outDir: 'dist',
  clean: true,
  bundle: false,
  splitting: false,
  sourcemap: false,
  dts: false,
  publicDir: false,
  onSuccess: async () => {
    // Phase 6 plan 06-04: preserve the chmod behavior AND copy the Lua script.
    const { chmodSync, copyFileSync, mkdirSync } = await import('node:fs');
    const path = await import('node:path');
    // 1. Preserve existing chmod (skip on Windows — matches prior behavior).
    if (process.platform !== 'win32') {
      chmodSync('dist/index.js', 0o755);
    }
    // 2. Copy the Lua script so runtime readFileSync(__dirname/sliding-window.lua)
    //    resolves in dist/lib/rate-limit/.
    const srcLua = path.resolve('src/lib/rate-limit/sliding-window.lua');
    const distLua = path.resolve('dist/lib/rate-limit/sliding-window.lua');
    mkdirSync(path.dirname(distLua), { recursive: true });
    copyFileSync(srcLua, distLua);
  },
  loader: {
    '.json': 'copy',
  },
  noExternal: [],
  external: [
    '@azure/msal-node',
    '@modelcontextprotocol/sdk',
    '@opentelemetry/api',
    '@opentelemetry/auto-instrumentations-node',
    '@opentelemetry/exporter-metrics-otlp-http',
    '@opentelemetry/exporter-prometheus',
    '@opentelemetry/exporter-trace-otlp-http',
    '@opentelemetry/instrumentation-pino',
    '@opentelemetry/resources',
    '@opentelemetry/sdk-node',
    '@opentelemetry/semantic-conventions',
    'commander',
    'dotenv',
    'express',
    'js-yaml',
    'nanoid',
    'pino',
    'pino-http',
    'pino-pretty',
    'zod',
  ],
});
