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
          const normalized = inner
            .replace(/\\"/g, '\0')
            .replace(/"/g, '\\"')
            .replace(/\0/g, '\\"');
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
  // Wrap single-quoted path strings containing 2+ `=':param'` occurrences in
  // backticks. Covers Graph function paths like
  //   reminderView(StartDateTime=':X',EndDateTime=':Y')
  let count = 0;
  const rebuilt = source.replace(
    /(path:\s*)'(\/[^'\n]*(=':[\w]+'[^'\n]*){2,})'/g,
    (_match, prefix, body) => {
      count++;
      return `${prefix}\`${body}\``;
    }
  );
  return { source: rebuilt, count };
}

/**
 * Run ALL post-merge fixes over a client.ts file. Writes back in place.
 * @param {string} clientPath absolute path to client.ts
 * @returns {{ describeFix: number, pathFix: number }}
 */
export function finalizeGeneratedClient(clientPath) {
  const raw = fs.readFileSync(clientPath, 'utf-8');
  const { source: step1, count: describeFix } = escapeNestedDescribeQuotes(raw);
  const { source: step2, count: pathFix } = fixMultiParamFunctionPaths(step1);
  if (describeFix > 0 || pathFix > 0) {
    fs.writeFileSync(clientPath, step2);
  }
  return { describeFix, pathFix };
}
