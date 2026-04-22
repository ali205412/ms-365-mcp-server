/**
 * Pure Zod-schema → JSON-Schema describer. Lives in its own module so
 * consumers that only need `describeToolSchema` (e.g. discovery handlers,
 * tests, future admin surfaces) do NOT transitively pull in the 45 MB
 * generated `src/generated/client.ts` catalog that `tool-schema.ts`
 * previously referenced via `import type { api }`.
 *
 * Even though the original import was type-only (and thus erased at
 * runtime), the TypeScript compiler still loads `client.ts` during
 * `tsc --noEmit` — at 45 MB / 1.4M lines that load cost is the root of
 * several vitest-OOM and docker-build-OOM reports. Switching consumers to
 * this file pins them to `endpoint-types.ts` (27 lines) instead.
 *
 * This file MUST stay dependency-free beyond `zod`, `zod-to-json-schema`,
 * and `../generated/endpoint-types.js`. If you need anything from
 * `api.endpoints` itself (e.g. lookup by alias), write it in
 * `tool-schema.ts` instead.
 */

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { Endpoint } from '../generated/endpoint-types.js';

/**
 * Unwrap a `ZodOptional` / `ZodDefault` / `ZodNullable` wrapper to expose
 * the inner schema. Returns `optional: true` for any of the three wrappers
 * so `describeToolSchema` can mark non-path parameters as non-required when
 * the Zod schema allows them to be omitted.
 */
function unwrapOptional(schema: z.ZodTypeAny): { inner: z.ZodTypeAny; optional: boolean } {
  const def = (schema as { _def?: { typeName?: string; innerType?: z.ZodTypeAny } })._def;
  const typeName = def?.typeName;
  if (typeName === 'ZodOptional' || typeName === 'ZodDefault' || typeName === 'ZodNullable') {
    return { inner: def!.innerType!, optional: true };
  }
  return { inner: schema, optional: false };
}

/**
 * Returns a JSON Schema describing every parameter a discovery tool accepts,
 * so an agent can construct a correctly-shaped `parameters` object for execute-tool.
 */
export function describeToolSchema(
  tool: Endpoint,
  llmTip: string | undefined
): {
  name: string;
  method: string;
  path: string;
  description: string;
  llmTip?: string;
  parameters: Array<{
    name: string;
    in: 'Path' | 'Query' | 'Body' | 'Header';
    required: boolean;
    description?: string;
    schema: unknown;
  }>;
} {
  const params = (tool.parameters ?? []).map((p) => {
    const { inner, optional } = unwrapOptional(p.schema as z.ZodTypeAny);
    const isPath = p.type === 'Path';
    const jsonSchema = zodToJsonSchema(inner, { target: 'jsonSchema7', $refStrategy: 'none' });
    const { $schema: _s, ...schema } = jsonSchema as Record<string, unknown>;
    return {
      name: p.name,
      in: p.type as 'Path' | 'Query' | 'Body' | 'Header',
      required: isPath || !optional,
      description: p.description,
      schema,
    };
  });

  return {
    name: tool.alias,
    method: tool.method.toUpperCase(),
    path: tool.path,
    description: tool.description ?? '',
    ...(llmTip ? { llmTip } : {}),
    parameters: params,
  };
}
