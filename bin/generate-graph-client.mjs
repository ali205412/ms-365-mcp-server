#!/usr/bin/env node
/**
 * Microsoft Graph OpenAPI -> Zod client codegen orchestrator.
 *
 * Plan 05-01 extended this orchestrator to support a full-coverage branch
 * alongside the v1 legacy 212-op path. Plan 05-02 appended the beta pipeline
 * step when full-coverage is on. Plan 05-08 appended the coverage verification
 * step AFTER the beta pipeline so the harness counts aliases emitted by BOTH
 * v1 and beta pipelines together. The branch is controlled by environment
 * variables that are read at `main()` entry:
 *
 *   MS365_MCP_FULL_COVERAGE (default "0")
 *     "1" -> retain every path from the Graph v1.0 spec (~5,021 ops) and
 *            skip the src/endpoints.json filter. The emitted
 *            src/generated/client.ts carries the full tool catalog AND the
 *            Plan 05-02 beta pipeline runs (step 4) -- appending every beta
 *            endpoint with the `__beta__` alias prefix. Plan 05-08 coverage
 *            harness (step 5) then counts ops per workload, diffs against
 *            bin/.last-coverage-snapshot.json, and writes
 *            docs/coverage-report.md.
 *     "0" -> legacy behavior (filter against src/endpoints.json => 212 ops).
 *            Beta pipeline AND coverage harness are both skipped entirely.
 *
 *   MS365_MCP_USE_SNAPSHOT (default "0")
 *     "1" -> prefer the committed openapi/openapi.yaml snapshot over the
 *            live Microsoft upstream. If the snapshot is missing AND the
 *            network is unreachable, codegen fails closed (T-05-01).
 *            Also honored by the beta pipeline for openapi/openapi-beta.yaml.
 *     "0" -> legacy download behavior (fetch when missing or --force).
 *
 *   MS365_MCP_ACCEPT_BETA_CHURN (default "0")
 *     Plan 05-02 churn guard (CONTEXT D-18). Consulted by runBetaPipeline's
 *     snapshot-diff step: when previously-known beta ops disappear from the
 *     upstream spec AND this env var is NOT "1", the build exits non-zero
 *     with a bounded preview of removed aliases. Set to "1" only after
 *     reviewing `bin/.last-beta-snapshot.json` diff and accepting the
 *     upstream shrinkage.
 *
 * For real-spec runs against the Microsoft upstream, raise the Node heap
 * to avoid OOM on recursive $ref expansion (Pitfall 1 in 05-RESEARCH.md):
 *
 *   NODE_OPTIONS=--max-old-space-size=8192 \
 *   MS365_MCP_FULL_COVERAGE=1 \
 *   npm run generate
 *
 * Test harness: tests import `main({ rootDir, simplifiers, generateMcpTools,
 * runBetaPipeline, runCoverageCheck })` from this module. The deps bag lets
 * tests stage a tmpdir and stub out the expensive `openapi-zod-client`
 * invocation while still exercising the real branch selection + simplifier
 * calls.
 *
 * Ordering contract (DO NOT reshuffle):
 *   1. downloadGraphOpenAPI
 *   2. simplify (full-surface or legacy)
 *   3. generateMcpTools (openapi-zod-client v1 codegen)
 *   4. runBetaPipeline (FULL_COVERAGE=1 only; merges __beta__-prefixed ops)
 *   5. runCoverageCheck (FULL_COVERAGE=1 only; diffs vs. snapshot, writes
 *      docs/coverage-report.md, throws on >10%% workload regression)
 *   6. compileEssentialsPreset (unconditional — validates 150-op preset
 *      against generated registry and emits ReadonlySet<string> artifact).
 *      Under FULL_COVERAGE=0 this throws on preset ops absent from the
 *      212-op legacy catalog; that is acceptable — surfaces the gap at
 *      generate time rather than shipping a broken preset.
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { downloadGraphOpenAPI } from './modules/download-openapi.mjs';
import { generateMcpTools as defaultGenerateMcpTools } from './modules/generate-mcp-tools.mjs';
import {
  createAndSaveSimplifiedOpenAPI,
  createAndSaveSimplifiedOpenAPIFullSurface,
} from './modules/simplified-openapi.mjs';
import { runBetaPipeline as defaultRunBetaPipeline } from './modules/beta.mjs';
import {
  runCoverageCheck as defaultRunCoverageCheck,
  renderMarkdownReport,
} from './modules/coverage-check.mjs';
import { compileEssentialsPreset as defaultCompileEssentialsPreset } from './modules/compile-preset.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ROOT = path.resolve(__dirname, '..');

/**
 * Orchestrate the codegen pipeline. When called with no arguments the
 * production layout is used (project root derived from this file's location,
 * real simplifiers + real zod-client invocation). Tests inject a `rootDir`
 * pointing at a staged tmpdir and stub the side-effectful dependencies.
 *
 * @param {object} [deps]
 * @param {string} [deps.rootDir]  Project root; defaults to this file's ../ .
 * @param {boolean} [deps.forceDownload]  Force a re-download of the spec.
 * @param {{createAndSaveSimplifiedOpenAPI: Function, createAndSaveSimplifiedOpenAPIFullSurface: Function}} [deps.simplifiers]
 *   Override either/both simplifier entry points.
 * @param {Function} [deps.generateMcpTools]  Override the zod-client invocation.
 * @param {Function} [deps.runBetaPipeline]  Override the Plan 05-02 beta pipeline.
 *   Only invoked when MS365_MCP_FULL_COVERAGE=1. Tests inject a stub that
 *   records invocation without running the real openapi-zod-client binary.
 * @param {Function} [deps.runCoverageCheck]  Override the Plan 05-08 coverage
 *   harness. Only invoked when MS365_MCP_FULL_COVERAGE=1. Receives
 *   (generatedClientPath, baselinePath, opts) and must return a report shape
 *   that renderMarkdownReport can consume.
 * @param {Function} [deps.compileEssentialsPreset]  Override the Plan 05-03 preset
 *   compile step. Tests inject a no-op stub when they stage a generated/client.ts
 *   without the 150 preset aliases; production uses the real implementation.
 * @returns {Promise<void>}
 */
export async function main(deps = {}) {
  const rootDir = deps.rootDir ?? DEFAULT_ROOT;
  const simplifiers = {
    createAndSaveSimplifiedOpenAPI,
    createAndSaveSimplifiedOpenAPIFullSurface,
    ...(deps.simplifiers ?? {}),
  };
  const generateMcpTools = deps.generateMcpTools ?? defaultGenerateMcpTools;
  const runBetaPipeline = deps.runBetaPipeline ?? defaultRunBetaPipeline;
  const runCoverageCheck = deps.runCoverageCheck ?? defaultRunCoverageCheck;
  const compileEssentialsPreset =
    deps.compileEssentialsPreset ?? defaultCompileEssentialsPreset;

  const forceDownload = deps.forceDownload ?? process.argv.slice(2).includes('--force');

  const openapiDir = path.join(rootDir, 'openapi');
  const srcDir = path.join(rootDir, 'src');

  const openapiFile = path.join(openapiDir, 'openapi.yaml');
  const openapiTrimmedFile = path.join(openapiDir, 'openapi-trimmed.yaml');
  const endpointsFile = path.join(srcDir, 'endpoints.json');

  const generatedDir = path.join(srcDir, 'generated');

  const fullCoverage = process.env.MS365_MCP_FULL_COVERAGE === '1';

  console.log('Microsoft Graph API OpenAPI Processor');
  console.log('------------------------------------');
  console.log(`   MS365_MCP_FULL_COVERAGE = ${fullCoverage ? '1' : '0'}`);
  console.log(
    `   MS365_MCP_USE_SNAPSHOT = ${process.env.MS365_MCP_USE_SNAPSHOT === '1' ? '1' : '0'}`
  );

  console.log('\n📥 Step 1: Downloading OpenAPI specification');
  const downloaded = await downloadGraphOpenAPI(openapiDir, openapiFile, undefined, forceDownload);

  if (downloaded) {
    console.log('\n✅ OpenAPI specification successfully downloaded');
  } else {
    console.log('\n⏭️ Download skipped (snapshot or existing file)');
  }

  if (fullCoverage) {
    console.log(
      '\n🔧 Step 2: Creating full-surface simplified OpenAPI (MS365_MCP_FULL_COVERAGE=1)'
    );
    simplifiers.createAndSaveSimplifiedOpenAPIFullSurface(openapiFile, openapiTrimmedFile);
  } else {
    console.log('\n🔧 Step 2: Creating simplified OpenAPI (legacy 212-op path)');
    simplifiers.createAndSaveSimplifiedOpenAPI(endpointsFile, openapiFile, openapiTrimmedFile);
  }
  console.log('✅ Successfully created simplified OpenAPI specification');

  console.log('\n🚀 Step 3: Generating client code using openapi-zod-client');
  generateMcpTools(null, generatedDir);
  console.log('✅ Successfully generated client code');

  if (fullCoverage) {
    console.log('\n🧪 Step 4: Running beta pipeline (MS365_MCP_FULL_COVERAGE=1)');
    const snapshotPath = path.join(__dirname, '.last-beta-snapshot.json');
    await runBetaPipeline(openapiDir, generatedDir, { snapshotPath });
    console.log('✅ Beta pipeline complete');

    console.log('\n📊 Step 5: Running coverage verification harness');
    const clientPath = path.join(generatedDir, 'client.ts');
    const coverageBaselinePath = path.join(rootDir, 'bin', '.last-coverage-snapshot.json');
    const report = runCoverageCheck(clientPath, coverageBaselinePath);

    // Persist the markdown report to docs/coverage-report.md (CI-friendly
    // rendering of the per-workload table + thresholds). Written regardless
    // of warnings; regressions would have thrown before this point.
    const docsDir = path.join(rootDir, 'docs');
    if (!fs.existsSync(docsDir)) {
      fs.mkdirSync(docsDir, { recursive: true });
    }
    const reportPath = path.join(docsDir, 'coverage-report.md');
    fs.writeFileSync(reportPath, renderMarkdownReport(report));
    console.log(`✅ Coverage report written: ${reportPath}`);

    if (report.warnings.length > 0) {
      console.log(`⚠️  Coverage warnings: ${report.warnings.length}`);
      for (const w of report.warnings) {
        console.log(`   - ${w}`);
      }
    }
    console.log(`   Totals: current=${report.totals.current}, baseline=${report.totals.baseline}`);
  }

  // Plan 05-03 Step 5: compile essentials-v1 preset -> generated-index.ts.
  // Runs unconditionally -- the preset is a 150-op constant that must stay
  // in sync with whichever registry shipped. Under FULL_COVERAGE=0 this
  // step will throw on the 4 subscription ops that only exist in the full
  // v1.0 spec (acceptable per plan -- surfaces the gap at generate time).
  console.log('\n📚 Step 5: Compiling essentials preset (plan 05-03)');
  const presetsDir = path.join(srcDir, 'presets');
  const { count: presetCount } = compileEssentialsPreset(generatedDir, presetsDir);
  console.log(`✅ Preset compiled (${presetCount} ops)`);
}

// Only auto-invoke when executed directly (node bin/generate-graph-client.mjs).
// Tests import { main } and call it manually with injected deps.
const invokedAsScript = process.argv[1] === __filename;
if (invokedAsScript) {
  main().catch((error) => {
    console.error('\n❌ Error processing OpenAPI specification:', error.message ?? error);
    process.exit(1);
  });
}
