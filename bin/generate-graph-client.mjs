#!/usr/bin/env node
/**
 * Microsoft Graph OpenAPI -> Zod client codegen orchestrator.
 *
 * Plan 05-01 extended this orchestrator to support a full-coverage branch
 * alongside the v1 legacy 212-op path. The branch is controlled by
 * environment variables that are read at `main()` entry:
 *
 *   MS365_MCP_FULL_COVERAGE (default "0")
 *     "1" -> retain every path from the Graph v1.0 spec (~5,021 ops) and
 *            skip the src/endpoints.json filter. The emitted
 *            src/generated/client.ts carries the full tool catalog.
 *     "0" -> legacy behavior (filter against src/endpoints.json => 212 ops).
 *
 *   MS365_MCP_USE_SNAPSHOT (default "0")
 *     "1" -> prefer the committed openapi/openapi.yaml snapshot over the
 *            live Microsoft upstream. If the snapshot is missing AND the
 *            network is unreachable, codegen fails closed (T-05-01).
 *     "0" -> legacy download behavior (fetch when missing or --force).
 *
 *   MS365_MCP_ACCEPT_BETA_CHURN (default "0")
 *     Reserved for Plan 05-02 (beta churn guard). Declared here so operators
 *     see the full Phase 5 env surface in one place.
 *
 * For real-spec runs against the Microsoft upstream, raise the Node heap
 * to avoid OOM on recursive $ref expansion (Pitfall 1 in 05-RESEARCH.md):
 *
 *   NODE_OPTIONS=--max-old-space-size=8192 \
 *   MS365_MCP_FULL_COVERAGE=1 \
 *   npm run generate
 *
 * Test harness: tests import `main({ rootDir, simplifiers, generateMcpTools })`
 * from this module. The deps bag lets tests stage a tmpdir and stub out the
 * expensive `openapi-zod-client` invocation while still exercising the real
 * branch selection + simplifier calls.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { downloadGraphOpenAPI } from './modules/download-openapi.mjs';
import { generateMcpTools as defaultGenerateMcpTools } from './modules/generate-mcp-tools.mjs';
import {
  createAndSaveSimplifiedOpenAPI,
  createAndSaveSimplifiedOpenAPIFullSurface,
} from './modules/simplified-openapi.mjs';

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
