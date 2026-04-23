import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

export function generateMcpTools(openApiSpec, outputDir) {
  try {
    console.log('Generating client code from OpenAPI spec using openapi-zod-client...');

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
      console.log(`Created directory: ${outputDir}`);
    }

    const rootDir = path.resolve(outputDir, '../..');
    const openapiDir = path.join(rootDir, 'openapi');
    const openapiTrimmedFile = path.join(openapiDir, 'openapi-trimmed.yaml');

    const clientFilePath = path.join(outputDir, 'client.ts');
    execSync(
      `npx -y openapi-zod-client "${openapiTrimmedFile}" -o "${clientFilePath}" --with-description --strict-objects --additional-props-default-value=false`,
      {
        stdio: 'inherit',
      }
    );

    console.log(`Generated client code at: ${clientFilePath}`);

    let clientCode = fs.readFileSync(clientFilePath, 'utf-8');
    clientCode = clientCode.replace(/'@zodios\/core';/, "'./hack.js';");

    clientCode = clientCode.replace(/\.strict\(\)/g, '.passthrough()');

    console.log('Stripping unused errors arrays from endpoint definitions...');
    // I didn't make up this crazy regex myself; you know who did. It seems works though.
    clientCode = clientCode.replace(/,?\s*errors:\s*\[[\s\S]*?],?(?=\s*})/g, '');

    console.log('Decoding HTML entities in path patterns...');
    // openapi-zod-client HTML-encodes special characters in path patterns
    // This breaks Microsoft Graph function-style APIs like range(address='A1:G10')
    clientCode = clientCode.replace(/&#x3D;/g, '='); // Decode = sign
    clientCode = clientCode.replace(/&#x27;/g, "'"); // Decode single quote
    clientCode = clientCode.replace(/&#x28;/g, '('); // Decode left paren
    clientCode = clientCode.replace(/&#x29;/g, ')'); // Decode right paren
    clientCode = clientCode.replace(/&#x3A;/g, ':'); // Decode colon

    console.log('Fixing function-style API paths with template literals...');
    // Path-literal wrapping is handled in a single pass by the finalization
    // step in bin/modules/escape-describe-quotes.mjs (fixMultiParamFunctionPaths).
    // That pass runs AFTER the beta + product pipelines have merged their
    // own endpoints into client.ts, so it sees the complete set of paths.
    // Doing it here would miss merges and produce mixed quote state.

    // Plan 05.1 + v1.1 hardening: Microsoft Graph description strings
    // frequently embed example snippets in double quotes, e.g.
    //   .describe("The description of the product (example: "Fabrikam...app."). ...")
    // openapi-zod-client emits these verbatim, producing TypeScript syntax
    // errors. Rewrite `.describe("…")` arguments to escape unbalanced
    // inner double quotes while preserving the leading `.describe("` and
    // trailing `")` boundary markers.
    console.log('Escaping nested double-quotes in describe() argument strings...');
    let escapeCount = 0;
    clientCode = clientCode.replace(
      /\.describe\("((?:[^"\\]|\\.)*)"\)/g,
      (match, inner) => {
        // If the captured "inner" still contains an unescaped " we split
        // across multiple describe()s — that only happens when openapi-zod-client
        // inserted unescaped example quotes. Re-escape them.
        if (!inner.includes('"')) return match;
        const escaped = inner.replace(/"/g, '\\"');
        escapeCount++;
        return `.describe("${escaped}")`;
      }
    );
    // Line-by-line pass: walk EVERY `.describe("` occurrence on a line (not
    // just the first) and repair nested quotes. Microsoft's Graph spec
    // contains describe strings like
    //   .describe("The description of the product (example: "Fabrikam for Business is a productivity app."). Returned by default. Read-only.")
    // where the opening inner `"` after `example: ` ends the describe string
    // prematurely. We find the TRUE close by scanning for `")` followed by a
    // known zod-chain sentinel, and escape every `"` between open and close.
    const chainSentinel = /"\)(?=(\.nullish\(\)|\.optional\(\)|\.default\(|\.describe\(|\.transform\(|\.nullable\(|,|\s*\}|\s*\)|$))/g;
    clientCode = clientCode
      .split('\n')
      .map((line) => {
        if (!line.includes('.describe("')) return line;
        let cursor = 0;
        let rebuilt = '';
        while (cursor < line.length) {
          const dIdx = line.indexOf('.describe("', cursor);
          if (dIdx === -1) {
            rebuilt += line.slice(cursor);
            break;
          }
          rebuilt += line.slice(cursor, dIdx) + '.describe("';
          const contentStart = dIdx + '.describe("'.length;
          // Find the next chain-sentinel-anchored `")` after contentStart.
          chainSentinel.lastIndex = contentStart;
          const m = chainSentinel.exec(line);
          if (!m) {
            // No well-formed close on this line — bail out of this describe.
            rebuilt += line.slice(contentStart);
            break;
          }
          const closeIdx = m.index;
          const inner = line.slice(contentStart, closeIdx);
          if (inner.includes('"')) {
            // Normalize: un-escape existing `\"` then re-escape every `"`.
            const normalized = inner.replace(/\\"/g, '\0').replace(/"/g, '\\"').replace(/\0/g, '\\"');
            rebuilt += normalized;
            escapeCount++;
          } else {
            rebuilt += inner;
          }
          rebuilt += '")';
          cursor = closeIdx + 2;
        }
        return rebuilt;
      })
      .join('\n');
    if (escapeCount > 0) {
      console.log(`Escaped nested double-quotes in ${escapeCount} describe() string(s)`);
    }

    fs.writeFileSync(clientFilePath, clientCode);

    return true;
  } catch (error) {
    throw new Error(`Error generating client code: ${error.message}`);
  }
}
