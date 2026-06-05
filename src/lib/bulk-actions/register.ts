import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type AuthManager from '../../auth.js';
import type GraphClient from '../../graph-client.js';
import type { CallToolResult } from '../../graph-tools.js';
import { getRequestTenant, requestContext } from '../../request-context.js';
import { checkDispatch } from '../tool-selection/dispatch-guard.js';
import { createMcpErrorEnvelope, createMcpResultEnvelope } from '../mcp-results/envelope.js';
import { emitMcpLogEvent } from '../mcp-logging/register.js';
import { confirmationIdFor } from '../safe-writes/classifier.js';
import {
  BULK_ACTION_TOOL,
  BULK_LIMITS,
  BulkActionInputZod,
  READ_BULK_RESULT_TOOL,
  ReadBulkResultInputZod,
  type BulkActionInput,
  type BulkOutputMode,
} from './schema.js';
import { buildBulkPlan, bulkPlanPublicSummary, currentContextSnapshot } from './plan.js';
import {
  bulkOwnerKey,
  readBulkResult,
  storeBulkResult,
  type BulkStoredItem,
} from './result-store.js';
import {
  byteLength,
  safeIdsPayload,
  sanitizeErrorCode,
  sanitizeMessage,
  sanitizeValue,
} from './sanitize.js';

export interface ExecuteToolAliasLikeArgs {
  toolName: string;
  parameters?: Record<string, unknown>;
  graphClient: GraphClient;
  authManager?: AuthManager;
  readOnly?: boolean;
  orgMode?: boolean;
}

export interface RegisterBulkActionToolsOptions {
  graphClient: GraphClient;
  authManager?: AuthManager;
  readOnly: boolean;
  orgMode: boolean;
  executeToolAlias: (args: ExecuteToolAliasLikeArgs) => Promise<CallToolResult>;
  enabledToolsPattern?: RegExp;
  enabledToolsSet?: ReadonlySet<string>;
}

function syntheticAllowed(alias: string): CallToolResult | null {
  const tenantInfo = getRequestTenant();
  const rejection = checkDispatch(
    alias,
    tenantInfo.enabledToolsSet,
    tenantInfo.id,
    tenantInfo.presetVersion
  );
  return rejection as CallToolResult | null;
}

function parseResultJson(result: CallToolResult): unknown {
  const text = result.content.find(
    (item): item is { type: 'text'; text: string } =>
      item.type === 'text' && typeof item.text === 'string'
  )?.text;
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { text: sanitizeMessage(text) };
  }
}

function codeFromResult(result: CallToolResult): string | undefined {
  const metaCode = result._meta?.errorCode;
  if (typeof metaCode === 'string') return sanitizeErrorCode(metaCode);
  const parsed = parseResultJson(result);
  if (typeof parsed === 'object' && parsed !== null) {
    const code =
      (parsed as Record<string, unknown>).code ?? (parsed as Record<string, unknown>).error;
    return sanitizeErrorCode(code);
  }
  return undefined;
}

function retryAfterFromResult(result: CallToolResult): number | undefined {
  const value = result._meta?.retryAfterSeconds;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function shapeItemData(mode: BulkOutputMode, result: CallToolResult): unknown {
  const parsed = parseResultJson(result);
  if (mode === 'ids') return safeIdsPayload(parsed);
  if (mode === 'full') return sanitizeValue(parsed);
  return undefined;
}

function renderBulkOutput(input: {
  planSummary: Record<string, unknown>;
  executionItems?: BulkStoredItem[];
  outputMode: BulkOutputMode;
  status: string;
  resultId?: string;
  resultExpiresAt?: string;
}): Record<string, unknown> {
  const failures = (input.executionItems ?? []).filter((item) => item.status !== 'succeeded');
  const base = {
    ...input.planSummary,
    status: input.status,
    ...(input.resultId ? { resultId: input.resultId, resultExpiresAt: input.resultExpiresAt } : {}),
  };
  if (!input.executionItems) return base;
  if (input.outputMode === 'summary') {
    return {
      ...base,
      failures: failures.map((item) => ({
        id: item.id,
        toolName: item.toolName,
        status: item.status,
        code: item.code,
        retryAfterSeconds: item.retryAfterSeconds,
      })),
    };
  }
  if (input.outputMode === 'errors') {
    return { ...base, errors: failures };
  }
  if (input.outputMode === 'ids') {
    return {
      ...base,
      items: input.executionItems.map((item) => ({
        id: item.id,
        toolName: item.toolName,
        status: item.status,
        code: item.code,
        retryAfterSeconds: item.retryAfterSeconds,
        data: item.data,
      })),
    };
  }
  return { ...base, items: input.executionItems };
}

async function emitBulkEvent(event: string, data: Record<string, unknown>): Promise<void> {
  await emitMcpLogEvent({
    tenantId: getRequestTenant().id,
    event,
    level: 'info',
    data: sanitizeValue(data) as Record<string, unknown>,
  });
}

async function handleBulkAction(
  rawInput: BulkActionInput,
  options: RegisterBulkActionToolsOptions,
  signal?: AbortSignal
): Promise<CallToolResult> {
  const parsed = BulkActionInputZod.safeParse(rawInput);
  if (!parsed.success) {
    return createMcpErrorEnvelope({
      toolName: BULK_ACTION_TOOL,
      summary: 'Bulk action input is invalid.',
      code: 'invalid_bulk_item',
      message: parsed.error.message,
    });
  }

  const dispatchRejection = syntheticAllowed(BULK_ACTION_TOOL);
  if (dispatchRejection) return dispatchRejection;

  const input = parsed.data;
  const plan = buildBulkPlan(input, { readOnly: options.readOnly, orgMode: options.orgMode });
  if ('error' in plan) {
    return createMcpErrorEnvelope({
      toolName: BULK_ACTION_TOOL,
      summary: 'Bulk action could not be planned.',
      code: plan.error,
      message: plan.message,
      data: currentContextSnapshot(),
    });
  }

  const planSummary = bulkPlanPublicSummary(plan);
  await emitBulkEvent(
    input.mode === 'preview' ? 'bulk-action.preview' : 'bulk-action.execute.plan',
    {
      digestPrefix: plan.planDigest.slice(0, 12),
      itemCount: plan.items.length,
      requiresConfirmation: plan.requiresConfirmation,
      outputMode: plan.outputMode,
    }
  );

  if (input.mode === 'preview') {
    return createMcpResultEnvelope({
      toolName: BULK_ACTION_TOOL,
      summary: `Bulk action preview created for ${plan.items.length} item${plan.items.length === 1 ? '' : 's'}.`,
      data: renderBulkOutput({ planSummary, outputMode: input.outputMode, status: 'preview' }),
      nextActions: plan.requiresConfirmation
        ? ['Call bulk-action with mode=execute and the returned confirmation object.']
        : ['Call bulk-action with mode=execute to run the allowed items.'],
      warnings: plan.items.some((item) => item.status !== 'allowed')
        ? ['some_items_blocked_or_invalid']
        : [],
      meta: { digestPrefix: plan.planDigest.slice(0, 12), ownerRef: bulkOwnerKey() },
    });
  }

  const invalidOrBlocked = plan.items.find((item) => item.status !== 'allowed');
  if (invalidOrBlocked) {
    return createMcpErrorEnvelope({
      toolName: BULK_ACTION_TOOL,
      summary: 'Bulk action execution blocked by invalid or disallowed items.',
      code: invalidOrBlocked.code ?? 'invalid_bulk_item',
      message: 'Re-run preview and remove or fix invalid/blocked items before executing.',
      data: planSummary,
      warnings: ['no_items_executed'],
    });
  }

  if (plan.requiresConfirmation) {
    if (!input.confirmation) {
      await emitBulkEvent('bulk-action.confirmation_required', {
        digestPrefix: plan.planDigest.slice(0, 12),
        itemCount: plan.items.length,
      });
      return createMcpErrorEnvelope({
        toolName: BULK_ACTION_TOOL,
        summary: 'Bulk action execution requires plan-bound confirmation.',
        code: 'confirmation_required',
        message: 'Execute requires confirmation confirmed=true with the exact preview planDigest.',
        data: {
          confirmation: { planDigest: plan.planDigest, confirmed: true, expiresAt: plan.expiresAt },
          itemCount: plan.items.length,
        },
      });
    }
    if (Date.parse(plan.expiresAt) <= Date.now()) {
      return createMcpErrorEnvelope({
        toolName: BULK_ACTION_TOOL,
        summary: 'Bulk action plan expired.',
        code: 'plan_expired',
        message: 'Re-run preview to create a fresh plan.',
      });
    }
    if (
      input.confirmation.planDigest !== plan.planDigest ||
      input.confirmation.confirmed !== true
    ) {
      await emitBulkEvent('bulk-action.confirmation_mismatch', {
        digestPrefix: plan.planDigest.slice(0, 12),
        itemCount: plan.items.length,
      });
      return createMcpErrorEnvelope({
        toolName: BULK_ACTION_TOOL,
        summary: 'Bulk action confirmation does not match this plan.',
        code: 'confirmation_mismatch',
        message: 'The confirmation digest must exactly match the current immutable plan.',
        warnings: ['no_items_executed'],
      });
    }
  }

  await emitBulkEvent('bulk-action.execute.start', {
    digestPrefix: plan.planDigest.slice(0, 12),
    itemCount: plan.items.length,
    outputMode: plan.outputMode,
  });
  const results: BulkStoredItem[] = [];
  for (const item of plan.items) {
    if (signal?.aborted) {
      results.push({
        id: item.id,
        toolName: item.toolName,
        status: 'cancelled',
        code: 'cancelled',
      });
      continue;
    }
    const plannedParams = plan.executionParameters.get(item.id) ?? {};
    const params = {
      ...plannedParams,
      ...(item.riskLevel === 'high'
        ? { confirmation: true, confirmationId: confirmationIdFor(item.toolName, 'high') }
        : {}),
      ...(signal ? { _signal: signal } : {}),
    };
    const ctx = requestContext.getStore() ?? {};
    const result = await requestContext.run({ ...ctx, toolAlias: item.toolName }, async () =>
      options.executeToolAlias({
        toolName: item.toolName,
        parameters: params,
        graphClient: options.graphClient,
        authManager: options.authManager,
        readOnly: options.readOnly,
        orgMode: options.orgMode,
      })
    );
    const code = codeFromResult(result);
    const shapedData = result.isError ? undefined : shapeItemData(input.outputMode, result);
    results.push({
      id: item.id,
      toolName: item.toolName,
      status: result.isError ? 'failed' : 'succeeded',
      ...(result.isError ? { code: code ?? 'graph_item_failed' } : {}),
      retryAfterSeconds: retryAfterFromResult(result),
      ...(shapedData !== undefined ? { data: shapedData } : {}),
    });
  }

  const successCount = results.filter((item) => item.status === 'succeeded').length;
  const status =
    successCount === results.length
      ? 'completed'
      : successCount === 0
        ? 'failed'
        : 'completed_with_errors';
  const preliminary = renderBulkOutput({
    planSummary,
    executionItems: results,
    outputMode: input.outputMode,
    status,
  });
  let resultId: string | undefined;
  let resultExpiresAt: string | undefined;
  if (input.outputMode === 'full' || byteLength(preliminary) > BULK_LIMITS.maxInlineResultBytes) {
    const stored = storeBulkResult({
      digest: plan.planDigest,
      items: results,
      summary: planSummary,
    });
    if ('error' in stored) {
      return createMcpErrorEnvelope({
        toolName: BULK_ACTION_TOOL,
        summary: 'Bulk action result could not be stored within output budgets.',
        code: stored.error,
        message: stored.message,
      });
    }
    resultId = stored.resultId;
    resultExpiresAt = stored.expiresAt;
    await emitBulkEvent('bulk-action.result_stored', {
      digestPrefix: plan.planDigest.slice(0, 12),
      itemCount: results.length,
    });
  }

  const output = renderBulkOutput({
    planSummary,
    executionItems: results,
    outputMode: input.outputMode,
    status,
    resultId,
    resultExpiresAt,
  });
  await emitBulkEvent('bulk-action.execute.complete', {
    digestPrefix: plan.planDigest.slice(0, 12),
    itemCount: results.length,
    successCount,
    failureCount: results.length - successCount,
    stored: Boolean(resultId),
  });
  return createMcpResultEnvelope({
    toolName: BULK_ACTION_TOOL,
    summary: `Bulk action ${status} for ${results.length} item${results.length === 1 ? '' : 's'}.`,
    data: output,
    nextActions: resultId
      ? ['Call read-bulk-result with resultId to page through sanitized details.']
      : ['Review statuses and retry failed items only if safe.'],
    warnings: status === 'completed' ? [] : ['some_items_failed'],
    meta: { digestPrefix: plan.planDigest.slice(0, 12), resultId, ownerRef: bulkOwnerKey() },
  });
}

async function handleReadBulkResult(rawInput: unknown): Promise<CallToolResult> {
  const parsed = ReadBulkResultInputZod.safeParse(rawInput);
  if (!parsed.success) {
    return createMcpErrorEnvelope({
      toolName: READ_BULK_RESULT_TOOL,
      summary: 'Bulk result read input is invalid.',
      code: 'invalid_cursor',
      message: parsed.error.message,
    });
  }
  const dispatchRejection = syntheticAllowed(READ_BULK_RESULT_TOOL);
  if (dispatchRejection) return dispatchRejection;
  const outcome = readBulkResult(parsed.data);
  if (!outcome.ok) {
    await emitBulkEvent('bulk-action.result_read_denied', { code: outcome.code });
    return createMcpErrorEnvelope({
      toolName: READ_BULK_RESULT_TOOL,
      summary: 'Bulk result read denied.',
      code: outcome.code,
      message: outcome.message,
    });
  }
  await emitBulkEvent('bulk-action.result_read', {
    resultId: parsed.data.resultId,
    itemCount: outcome.value.items.length,
  });
  return createMcpResultEnvelope({
    toolName: READ_BULK_RESULT_TOOL,
    summary: `Read ${outcome.value.items.length} bulk result item${outcome.value.items.length === 1 ? '' : 's'}.`,
    data: outcome.value,
    nextActions: outcome.value.nextCursor
      ? ['Call read-bulk-result again with nextCursor for more items.']
      : ['No further bulk result pages remain.'],
    meta: { resultId: outcome.value.resultId, ownerRef: bulkOwnerKey() },
  });
}

function patternAllows(pattern: RegExp | undefined, alias: string): boolean {
  if (!pattern) return true;
  pattern.lastIndex = 0;
  return pattern.test(alias);
}

function setAllows(enabledToolsSet: ReadonlySet<string> | undefined, alias: string): boolean {
  return enabledToolsSet === undefined || enabledToolsSet.size === 0 || enabledToolsSet.has(alias);
}

export function registerBulkActionTools(
  server: McpServer,
  options: RegisterBulkActionToolsOptions
): number {
  let registered = 0;
  if (
    patternAllows(options.enabledToolsPattern, BULK_ACTION_TOOL) &&
    setAllows(options.enabledToolsSet, BULK_ACTION_TOOL)
  ) {
    server.tool(
      BULK_ACTION_TOOL,
      'Preview or execute a catalog-driven bulk action. Items name generated Graph/product tool aliases and parameters; raw URLs, methods, headers, and $batch request shapes are rejected. Preview returns a plan digest; writes, high-risk, open-world, or high-volume plans require executing with the exact confirmation object.',
      {
        mode: z.enum(['preview', 'execute']).default('preview'),
        items: z
          .array(
            z
              .object({
                id: z.string().optional(),
                toolName: z.string(),
                parameters: z.record(z.unknown()).optional(),
              })
              .passthrough()
          )
          .min(1)
          .max(BULK_LIMITS.maxItems),
        outputMode: z.enum(['summary', 'errors', 'ids', 'full']).default('summary'),
        confirmation: z
          .object({
            planDigest: z.string(),
            confirmed: z.literal(true),
            expiresAt: z.string().optional(),
          })
          .optional(),
      },
      { title: BULK_ACTION_TOOL, readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      async (params, extra) =>
        handleBulkAction(
          params as BulkActionInput,
          options,
          (extra as { signal?: AbortSignal } | undefined)?.signal
        )
    );
    registered++;
  }
  if (
    patternAllows(options.enabledToolsPattern, READ_BULK_RESULT_TOOL) &&
    setAllows(options.enabledToolsSet, READ_BULK_RESULT_TOOL)
  ) {
    server.tool(
      READ_BULK_RESULT_TOOL,
      'Read paginated sanitized details for a bulk-action resultId. Access is tenant and owner scoped; expired, mismatched, or invalid cursors fail closed.',
      {
        resultId: z.string(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(BULK_LIMITS.maxReadLimit).optional(),
      },
      { title: READ_BULK_RESULT_TOOL, readOnlyHint: true, openWorldHint: false },
      async (params) => handleReadBulkResult(params)
    );
    registered++;
  }
  return registered;
}
