import fs from 'fs';

const DEFAULT_OPENAPI_URL =
  'https://raw.githubusercontent.com/microsoftgraph/msgraph-metadata/refs/heads/master/openapi/v1.0/openapi.yaml';

/**
 * Download the Microsoft Graph OpenAPI spec.
 *
 * Plan 05-01 (T-05-01 mitigation): when `MS365_MCP_USE_SNAPSHOT=1` is set in
 * the process environment, the committed snapshot at `targetFile` is preferred
 * over the live network fetch. This lets CI and offline dev runs regenerate
 * the client deterministically and fail closed (return false) if the network
 * is unreachable AND the snapshot is missing — rather than silently emitting
 * a truncated `client.ts`.
 *
 * @returns {Promise<boolean>} true iff the file was freshly downloaded this call.
 *   Returns false when the snapshot was reused or no download occurred.
 */
export async function downloadGraphOpenAPI(
  targetDir,
  targetFile,
  openapiUrl = DEFAULT_OPENAPI_URL,
  forceDownload = false
) {
  const useSnapshot = process.env.MS365_MCP_USE_SNAPSHOT === '1';

  if (!fs.existsSync(targetDir)) {
    console.log(`Creating directory: ${targetDir}`);
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Snapshot-first: when the operator has opted into snapshot mode AND the
  // target already contains a usable spec, short-circuit before any network
  // activity. This holds even when forceDownload=true (snapshot wins).
  if (useSnapshot && fs.existsSync(targetFile)) {
    console.log(`Using committed snapshot (MS365_MCP_USE_SNAPSHOT=1): ${targetFile}`);
    return false;
  }

  if (fs.existsSync(targetFile) && !forceDownload) {
    console.log(`OpenAPI specification already exists at ${targetFile}`);
    console.log('Use --force to download again');
    return false;
  }

  console.log(`Downloading OpenAPI specification from ${openapiUrl}`);

  try {
    const response = await fetch(openapiUrl);

    if (!response.ok) {
      throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
    }

    const content = await response.text();
    fs.writeFileSync(targetFile, content);
    console.log(`OpenAPI specification downloaded to ${targetFile}`);
    return true;
  } catch (error) {
    console.error('Error downloading OpenAPI specification:', error.message);
    // Snapshot fallback: if the operator opted into snapshot mode and a
    // previous snapshot file is on disk, degrade gracefully instead of
    // blowing up the entire codegen. T-05-01 — never fail-open with a
    // truncated spec; falling back to the committed snapshot is deterministic.
    if (useSnapshot && fs.existsSync(targetFile)) {
      console.warn(
        'Network unreachable; falling back to committed snapshot (MS365_MCP_USE_SNAPSHOT=1)'
      );
      return false;
    }
    throw error;
  }
}
