/**
 * Post-processor that fixes unescaped double-quotes inside `.describe("…")`
 * argument strings in the generated client.ts. Microsoft's Graph OpenAPI spec
 * frequently embeds example snippets in quotes (e.g.
 * `example: "Fabrikam for Business is a productivity app."`) which
 * openapi-zod-client emits verbatim, producing TypeScript syntax errors.
 *
 * Runs as a FINALIZATION pass after ALL merge pipelines (v1 generate, beta
 * pipeline, product pipelines) have completed their writes to client.ts.
 *
 * Also handles multi-parameter Graph function paths like
 *   reminderView(StartDateTime=':X',EndDateTime=':Y')
 * where multiple `=':param'` occurrences would otherwise leave unescaped
 * nested single quotes inside single-quoted path strings.
 */

import fs from 'node:fs';

const CHAIN_SENTINEL =
  /"\)(?=(\.nullish\(\)|\.optional\(\)|\.default\(|\.describe\(|\.transform\(|\.nullable\(|,|\s*\}|\s*\)|$))/g;

function escapeNestedDescribeQuotes(source) {
  let escapeCount = 0;
  const rebuilt = source
    .split('\n')
    .map((line) => {
      if (!line.includes('.describe("')) return line;
      let cursor = 0;
      let out = '';
      while (cursor < line.length) {
        const dIdx = line.indexOf('.describe("', cursor);
        if (dIdx === -1) {
          out += line.slice(cursor);
          break;
        }
        out += line.slice(cursor, dIdx) + '.describe("';
        const contentStart = dIdx + '.describe("'.length;
        CHAIN_SENTINEL.lastIndex = contentStart;
        const m = CHAIN_SENTINEL.exec(line);
        if (!m) {
          out += line.slice(contentStart);
          break;
        }
        const closeIdx = m.index;
        const inner = line.slice(contentStart, closeIdx);
        if (inner.includes('"')) {
          const normalized = inner.replace(/\\"/g, '\0').replace(/"/g, '\\"').replace(/\0/g, '\\"');
          out += normalized;
          escapeCount++;
        } else {
          out += inner;
        }
        out += '")';
        cursor = closeIdx + 2;
      }
      return out;
    })
    .join('\n');
  return { source: rebuilt, count: escapeCount };
}

function fixMultiParamFunctionPaths(source) {
  // Wrap ANY path string containing `=':param'` occurrences in backticks.
  // Covers paths like:
  //   path: '/users/.../getPolicyId(type=':type',name=':name')'
  //   path: `/users/.../getPolicyId(type=':type',name=`:name')'
  //     ^ already-corrupted by a single-substitution pass earlier
  // We normalize by finding any `path: [quote]...[quote]` that contains
  // `=':` and wrapping the whole content in fresh backticks, stripping any
  // pre-existing backticks inside the content.
  let count = 0;
  const rebuilt = source
    .split('\n')
    .map((line) => {
      // Trigger on ANY path line containing nested single quotes inside
      // parentheses — covers `=':param'` (Graph function params), `='@uid'`
      // (literal @-prefixed params), and any other '(...' pattern.
      if (!line.includes('(')) return line;
      const pathIdx = line.indexOf('path:');
      if (pathIdx === -1) return line;
      // Count single quotes after `path:` — if more than 2 (open + close)
      // then there's nested content requiring backtick wrapping.
      const tail = line.slice(pathIdx + 5);
      const singleQuoteCount = (tail.match(/'/g) || []).length;
      if (singleQuoteCount <= 2) return line;
      // Locate the opening quote of the path value.
      let openIdx = -1;
      for (let i = pathIdx + 5; i < line.length; i++) {
        const c = line[i];
        if (c === ' ' || c === '\t') continue;
        if (c === "'" || c === '`' || c === '"') {
          openIdx = i;
          break;
        }
        return line; // not a quoted value
      }
      if (openIdx === -1) return line;
      // Find the close of the path value by locating the last `,` that
      // terminates a zodios endpoint field (`method:`, `alias:`,
      // `requestFormat:`, `parameters:`, `response:`, `errors:`) after
      // the path opener. The char immediately before that `,` is the
      // true path-value closer.
      // Multi-field inline pattern: path AND following field on same line.
      // Also matches end-of-line pattern where path is on its own line and
      // ends with a trailing `,` (next zodios field is on the next line).
      const fieldSep =
        /,\s*(method|alias|requestFormat|parameters|response|errors|description)\s*:|,\s*$/g;
      fieldSep.lastIndex = openIdx + 1;
      const m = fieldSep.exec(line);
      if (!m) return line;
      const sepIdx = m.index; // index of the `,`
      // Closer is the char right before the comma.
      const closerIdx = sepIdx - 1;
      const rawBody = line.slice(openIdx + 1, closerIdx);
      // Strip backticks + strip original opening/closing quote chars if
      // any ended up inside from prior mangling.
      const clean = rawBody.replace(/`/g, '');
      count++;
      return (
        line.slice(0, openIdx) + '`' + clean + '`' + line.slice(sepIdx) // keep the `, method: ...` continuation intact
      );
    })
    .join('\n');
  return { source: rebuilt, count };
}

/**
 * Run ALL post-merge fixes over a client.ts file. Writes back in place.
 * When clientPath does not exist (e.g., tests that stub `generateMcpTools`
 * to a no-op and never emit client.ts), this function is a no-op and
 * returns zero counts — there is nothing to finalize.
 * @param {string} clientPath absolute path to client.ts
 * @returns {{ describeFix: number, pathFix: number }}
 */
export function finalizeGeneratedClient(clientPath) {
  if (!fs.existsSync(clientPath)) {
    return { describeFix: 0, pathFix: 0 };
  }
  const raw = fs.readFileSync(clientPath, 'utf-8');
  const { source: step1, count: describeFix } = escapeNestedDescribeQuotes(raw);
  const { source: step2, count: pathFix } = fixMultiParamFunctionPaths(step1);
  if (describeFix > 0 || pathFix > 0) {
    fs.writeFileSync(clientPath, step2);
  }
  return { describeFix, pathFix };
}
