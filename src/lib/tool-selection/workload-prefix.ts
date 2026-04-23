/**
 * Pure string → workload-prefix mapping (D-06). Lives in its own module so
 * consumers that only need the label helper (e.g. `src/lib/otel-metrics.ts`)
 * do NOT transitively pull in the 45 MB generated `src/generated/client.ts`
 * catalog that `registry-validator.ts` imports at top level.
 *
 * This file MUST stay dependency-free beyond `./products` (a 5-entry
 * constants table). If you need anything from `api.endpoints`, write it in
 * `registry-validator.ts` instead.
 */

import { PRODUCT_AUDIENCES } from '../auth/products.js';

/**
 * Extract the workload prefix for metric label cardinality control (D-06).
 *
 * Examples:
 *   "list-mail-messages"           → "list"
 *   "__beta__security-alerts"       → "security"
 *   "mail.messages.send"            → "mail"
 *   "__powerbi__GroupsGetGroups"    → "powerbi"
 *   "__spadmin__list-sites"         → "sp-admin"
 */
export function extractWorkloadPrefix(alias: string): string {
  // Phase 5.1: product prefix → product name is the workload.
  // The 5-entry iteration is O(1) in practice; the alias-building pass runs
  // once at module load so this is never on a hot path.
  for (const audience of PRODUCT_AUDIENCES.values()) {
    if (alias.startsWith(audience.prefix)) {
      return audience.product;
    }
  }
  // Existing Graph behavior unchanged:
  const stripped = alias.startsWith('__beta__') ? alias.slice('__beta__'.length) : alias;
  const dash = stripped.indexOf('-');
  const dot = stripped.indexOf('.');
  const dashIdx = dash === -1 ? Infinity : dash;
  const dotIdx = dot === -1 ? Infinity : dot;
  const cutoff = Math.min(dashIdx, dotIdx);
  return cutoff === Infinity ? stripped : stripped.slice(0, cutoff);
}
