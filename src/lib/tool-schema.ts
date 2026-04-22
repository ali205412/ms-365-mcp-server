/**
 * Legacy re-export shim. The actual implementation moved to
 * `./tool-schema-describer.ts` so callers that only need the describer do
 * NOT transitively force TypeScript to load `src/generated/client.ts`
 * (45 MB / 1.4M lines). New callers should import directly from
 * `./tool-schema-describer.js`; this file is kept so existing imports of
 * `./lib/tool-schema` keep working.
 */
export { describeToolSchema } from './tool-schema-describer.js';
