import fs from 'fs';

/**
 * Post-regen pass that stubs every `microsoft_graph_*` identifier referenced
 * by the generated client.ts but never declared as a `const` or `let`.
 *
 * Root cause (recorded 2026-04-20 while shipping Phase 5): Microsoft's v1.0
 * and beta OpenAPI specs share a minority of schema identifiers that neither
 * the v1 nor beta codegen pass declares under the `microsoft_graph_*` name
 * convention. The downstream `openapi-zod-client` emits references to those
 * identifiers (in `z.array(X)` and `schema: X` positions) but no
 * corresponding declaration. The module therefore throws at import time:
 *
 *   ReferenceError: microsoft_graph_accessReview is not defined
 *
 * Previously these were patched by hand in `dist/generated/client.js` after
 * each build — a step that did not survive clean regens. This module makes
 * the fix part of the codegen pipeline so a fresh checkout produces a
 * runnable client.js without manual intervention.
 *
 * Strategy: scan the final client.ts (AFTER v1 codegen AND beta merge),
 * find identifiers referenced as values but never declared, and inject
 * `const <name>: z.ZodTypeAny = z.any();` stubs immediately AFTER the
 * `import { z } from 'zod';` line. The stubs MUST sit above every other
 * `const` so later declarations can reference them eagerly — e.g.
 * `const accessReviewCollectionResponse = z.object({ value:
 * z.array(microsoft_graph_accessReview) });` is evaluated at module-load
 * time, before the `endpoints` array is reached, so injecting stubs just
 * before the endpoints anchor would trigger a temporal-dead-zone error.
 * `z.any()` is chosen deliberately — the schemas are upstream-undefined
 * types with no known shape, so erasing validation is the only safe
 * contract. Runtime behaviour matches what the manual stubs were doing;
 * the only change is automation.
 *
 * Why scan both `let` and `const`: Microsoft's recursive schema pattern
 * uses forward-declared `let X: z.ZodTypeAny;` followed by later `const X:
 * z.ZodTypeAny = z.lazy(() => ...);`. Missing either half re-introduces the
 * bug the beta-schema merge fix (commit d01e0a1) already closed.
 *
 * Only stubs identifiers under the `microsoft_graph_*` namespace. Other
 * undefined identifiers would indicate a real codegen bug, not upstream
 * surface drift — we want those to fail loudly rather than silently stub.
 *
 * Idempotent: running twice produces the same output. Stubs themselves are
 * `const` declarations so the second pass finds them defined and emits
 * nothing.
 *
 * @param {string} clientPath Absolute path to src/generated/client.ts.
 * @returns {{stubbed: string[]}} Sorted list of identifiers that were stubbed.
 */
export function stubMissingSchemas(clientPath) {
  const source = fs.readFileSync(clientPath, 'utf-8');

  const refRegex = /\b(microsoft_graph_[A-Za-z0-9_]+)\b/g;
  const defRegex = /(?:^|\n)\s*(?:let|const)\s+(microsoft_graph_[A-Za-z0-9_]+)\s*[:=]/g;

  const referenced = new Set();
  const defined = new Set();

  let m;
  while ((m = refRegex.exec(source)) !== null) referenced.add(m[1]);
  while ((m = defRegex.exec(source)) !== null) defined.add(m[1]);

  const missing = [...referenced].filter((name) => !defined.has(name)).sort();
  if (missing.length === 0) {
    return { stubbed: [] };
  }

  const anchor = /(import\s+\{\s*z\s*\}\s+from\s+['"]zod['"];?\n)/;
  if (!anchor.test(source)) {
    throw new Error("Stub injector: cannot locate `import { z } from 'zod'` anchor");
  }

  const header = `// ---- stub-missing-schemas: ${missing.length} upstream-undefined schemas ----\n`;
  const body = missing.map((name) => `const ${name}: z.ZodTypeAny = z.any();`).join('\n');
  const block = `\n${header}${body}\n// ---- end stub-missing-schemas ----\n`;

  const patched = source.replace(anchor, `$1${block}`);
  fs.writeFileSync(clientPath, patched);

  return { stubbed: missing };
}
