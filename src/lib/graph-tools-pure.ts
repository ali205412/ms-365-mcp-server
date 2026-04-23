/**
 * Pure helpers extracted from `src/graph-tools.ts`. Lives in its own
 * module so consumers that only need these utilities do NOT transitively
 * pull in the 45 MB generated `src/generated/client.ts` catalog that
 * `graph-tools.ts` imports at top level via `import { api } from
 * './generated/client.js'`.
 *
 * Everything here operates on primitive types or structurally-typed
 * arguments — none of these functions read `api.endpoints` directly.
 * If you need anything that iterates `api.endpoints` (e.g. registering
 * tools, resolving by alias), keep it in `graph-tools.ts` instead.
 *
 * This file MUST stay dependency-free beyond `./bm25.js` + `../logger.js`.
 * Adding any import that transitively pulls `generated/client.js` defeats
 * the whole point of the split.
 */

import logger from '../logger.js';
import { buildBM25Index, scoreQuery, tokenize, type BM25Index } from './bm25.js';

export interface DiscoverySearchIndex {
  bm25: BM25Index;
  nameTokens: Map<string, Set<string>>;
}

/**
 * Structural view of a single entry in the discovery tool registry.
 * The richer `buildToolsRegistry` return type in `graph-tools.ts`
 * projects into this shape at call time — we deliberately keep it
 * narrow so this module stays free of the `api.endpoints` type graph.
 */
export interface DiscoveryRegistryEntry {
  tool: {
    path: string;
    description?: string;
  };
  config?: {
    llmTip?: string;
  };
}

/**
 * Read `MS365_MCP_MAX_TOP` from the environment and return a positive
 * integer cap, or `undefined` if the variable is unset / invalid.
 * Logs a warning (never an error) on malformed input so operators see
 * the misconfiguration without a crash on startup.
 */
export function maxTopFromEnv(): number | undefined {
  const raw = process.env.MS365_MCP_MAX_TOP;
  if (raw === undefined || raw === '') return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    logger.warn(
      `Ignoring invalid MS365_MCP_MAX_TOP=${JSON.stringify(raw)} (use a positive integer)`
    );
    return undefined;
  }
  return n;
}

/**
 * Mutating helper: clamp the `$top` query param down to the configured
 * `MS365_MCP_MAX_TOP` ceiling. No-op when the env var is unset, when
 * `$top` is absent, or when the requested value is already within range.
 *
 * Deliberately mutates `queryParams` in place because it is the last
 * pre-request pass and callers already treat the param map as scratch.
 */
export function clampTopQueryParam(queryParams: Record<string, string>): void {
  const cap = maxTopFromEnv();
  if (cap === undefined || queryParams['$top'] === undefined) return;
  const requested = Number.parseInt(queryParams['$top'], 10);
  if (!Number.isFinite(requested) || requested <= cap) return;
  logger.info(`Clamping $top from ${requested} to ${cap} (MS365_MCP_MAX_TOP)`);
  queryParams['$top'] = String(cap);
}

/**
 * Builds a BM25 index over the tool registry. Name tokens are weighted 3x and llmTip
 * tokens 2x via repetition, so a tool whose name matches the query outranks one that
 * merely mentions the query term in its Microsoft-supplied description.
 *
 * The registry parameter is structurally typed on purpose — callers pass
 * `ReturnType<typeof buildToolsRegistry>` (defined in graph-tools.ts) which
 * is a superset of `Map<string, DiscoveryRegistryEntry>`.
 */
export function buildDiscoverySearchIndex(
  toolsRegistry: Map<string, DiscoveryRegistryEntry>
): DiscoverySearchIndex {
  // Cap contribution from the `description` and `llmTip` fields so a verbose llmTip
  // (e.g. the KQL search-syntax guide on list-mail-messages, ~300 tokens) doesn't
  // inflate a tool's doc length and crush BM25's length normalization. Names and
  // paths are short and reliable, so they stay uncapped and are repeated to carry
  // the bulk of the ranking signal. Tip excerpt (12 tokens) is enough to capture
  // the first "what this tool does" phrase without swamping the doc.
  const TIP_EXCERPT_TOKENS = 12;
  const DESC_CAP_TOKENS = 40;
  const docs: Array<{ id: string; tokens: string[] }> = [];
  const nameTokens = new Map<string, Set<string>>();
  for (const [name, { tool, config }] of toolsRegistry) {
    const nt = tokenize(name);
    nameTokens.set(name, new Set(nt));
    const pathTokens = tokenize(tool.path);
    const descTokens = tokenize(tool.description).slice(0, DESC_CAP_TOKENS);
    const tipTokens = tokenize(config?.llmTip).slice(0, TIP_EXCERPT_TOKENS);
    const tokens = [
      ...nt,
      ...nt,
      ...nt,
      ...nt,
      ...nt,
      ...pathTokens,
      ...pathTokens,
      ...tipTokens,
      ...descTokens,
    ];
    docs.push({ id: name, tokens });
  }
  return { bm25: buildBM25Index(docs), nameTokens };
}

/**
 * BM25 + a "name precision" bonus: reward tools whose names contain a high fraction
 * of the query tokens (and consist mostly of query-matching tokens). This counteracts
 * cases where a tool with a longer or more off-topic description outranks a tool
 * whose name directly matches — a common problem because many endpoint descriptions
 * are the wrong Graph prose pasted in.
 */
export function scoreDiscoveryQuery(
  query: string,
  index: DiscoverySearchIndex
): Array<{ id: string; score: number }> {
  const queryTokenSet = new Set(tokenize(query));
  if (queryTokenSet.size === 0) return [];
  const ranked = scoreQuery(query, index.bm25);
  const NAME_BONUS_WEIGHT = 2;
  for (const r of ranked) {
    const nt = index.nameTokens.get(r.id);
    if (!nt || nt.size === 0) continue;
    let matchedIdf = 0;
    let matchedCount = 0;
    for (const qt of queryTokenSet) {
      if (nt.has(qt)) {
        matchedCount++;
        matchedIdf += index.bm25.idf.get(qt) ?? 0;
      }
    }
    if (matchedCount === 0) continue;
    const precision = matchedCount / nt.size;
    r.score += precision * matchedIdf * NAME_BONUS_WEIGHT;
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}
