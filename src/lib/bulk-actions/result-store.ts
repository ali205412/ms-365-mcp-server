import { randomBytes } from 'node:crypto';
import { getRequestOwnerSubject, getRequestTenant, requestContext } from '../../request-context.js';
import { BULK_LIMITS, type BulkErrorCode } from './schema.js';
import { byteLength, sha256Hex } from './sanitize.js';

export interface BulkStoredItem {
  id: string;
  toolName: string;
  status: string;
  code?: string;
  retryAfterSeconds?: number;
  data?: unknown;
}

interface StoredResult {
  resultId: string;
  tenantId: string;
  ownerKey: string;
  createdAt: number;
  expiresAt: number;
  digest: string;
  items: BulkStoredItem[];
  summary: Record<string, unknown>;
}

export type ReadBulkResultOutcome =
  | {
      ok: true;
      value: {
        resultId: string;
        expiresAt: string;
        nextCursor?: string;
        items: BulkStoredItem[];
        summary: Record<string, unknown>;
      };
    }
  | { ok: false; code: BulkErrorCode; message: string };

const store = new Map<string, StoredResult>();
const PROCESS_LOCAL_BULK_RESULTS_ENV = 'MS365_MCP_ENABLE_PROCESS_LOCAL_BULK_RESULTS';
const cursors = new Map<
  string,
  { resultId: string; tenantId: string; ownerKey: string; offset: number; expiresAt: number }
>();

function tenantId(): string | undefined {
  return getRequestTenant().id ?? requestContext.getStore()?.tenantId ?? undefined;
}

export function processLocalBulkResultsEnabled(): boolean {
  const value = process.env[PROCESS_LOCAL_BULK_RESULTS_ENV];
  return value === 'true' || value === '1';
}

export function bulkOwnerKey(): string {
  const ctx = requestContext.getStore();
  const owner = getRequestOwnerSubject();
  if (owner) return `${ctx?.flow ?? 'unknown'}:${sha256Hex(owner)}`;
  if (ctx?.flow === 'app-only') return 'app-only:tenant-wide';
  return `process:${sha256Hex(process.cwd())}`;
}

function sweep(now = Date.now()): void {
  for (const [id, result] of store.entries()) {
    if (result.expiresAt <= now) store.delete(id);
  }
  for (const [cursor, state] of cursors.entries()) {
    if (state.expiresAt <= now) cursors.delete(cursor);
  }
}

export function storeBulkResult(input: {
  digest: string;
  items: BulkStoredItem[];
  summary: Record<string, unknown>;
}): { resultId: string; expiresAt: string } | { error: BulkErrorCode; message: string } {
  if (!processLocalBulkResultsEnabled()) {
    return {
      error: 'result_store_unavailable',
      message:
        'Bulk result pagination requires durable storage; process-local result IDs are disabled by default.',
    };
  }
  sweep();
  const currentTenant = tenantId();
  if (!currentTenant)
    return { error: 'tenant_context_unavailable', message: 'Tenant context unavailable.' };
  const ownerKey = bulkOwnerKey();
  const items = input.items.slice(0, BULK_LIMITS.maxStoredItems);
  const payloadBytes = byteLength({ items, summary: input.summary });
  if (payloadBytes > BULK_LIMITS.maxStoredResultBytes) {
    return {
      error: 'output_budget_exceeded',
      message: 'Sanitized bulk result exceeds storage budget.',
    };
  }
  const now = Date.now();
  const resultId = `bulk_${randomBytes(18).toString('base64url')}`;
  const expiresAt = now + BULK_LIMITS.resultTtlMs;
  store.set(resultId, {
    resultId,
    tenantId: currentTenant,
    ownerKey,
    createdAt: now,
    expiresAt,
    digest: input.digest,
    items,
    summary: input.summary,
  });
  return { resultId, expiresAt: new Date(expiresAt).toISOString() };
}

function makeCursor(result: StoredResult, offset: number): string {
  const cursor = `cur_${randomBytes(18).toString('base64url')}`;
  cursors.set(cursor, {
    resultId: result.resultId,
    tenantId: result.tenantId,
    ownerKey: result.ownerKey,
    offset,
    expiresAt: result.expiresAt,
  });
  return cursor;
}

export function readBulkResult(input: {
  resultId: string;
  cursor?: string;
  limit?: number;
}): ReadBulkResultOutcome {
  if (!processLocalBulkResultsEnabled()) {
    return {
      ok: false,
      code: 'result_store_unavailable',
      message: 'Bulk result pagination is unavailable without durable storage.',
    };
  }
  sweep();
  const currentTenant = tenantId();
  if (!currentTenant)
    return {
      ok: false,
      code: 'tenant_context_unavailable',
      message: 'Tenant context unavailable.',
    };
  const ownerKey = bulkOwnerKey();
  const result = store.get(input.resultId);
  if (!result) return { ok: false, code: 'result_not_found', message: 'Bulk result not found.' };
  if (result.expiresAt <= Date.now()) {
    store.delete(input.resultId);
    return { ok: false, code: 'result_expired', message: 'Bulk result expired.' };
  }
  if (result.tenantId !== currentTenant)
    return { ok: false, code: 'tenant_mismatch', message: 'Bulk result tenant mismatch.' };
  if (result.ownerKey !== ownerKey)
    return { ok: false, code: 'owner_mismatch', message: 'Bulk result owner mismatch.' };

  let offset = 0;
  if (input.cursor) {
    const cursorState = cursors.get(input.cursor);
    cursors.delete(input.cursor);
    if (
      !cursorState ||
      cursorState.resultId !== input.resultId ||
      cursorState.tenantId !== currentTenant ||
      cursorState.ownerKey !== ownerKey
    ) {
      return { ok: false, code: 'invalid_cursor', message: 'Bulk result cursor is invalid.' };
    }
    offset = cursorState.offset;
  }

  const limit = Math.min(Math.max(input.limit ?? 20, 1), BULK_LIMITS.maxReadLimit);
  const items = result.items.slice(offset, offset + limit);
  const nextOffset = offset + items.length;
  const nextCursor = nextOffset < result.items.length ? makeCursor(result, nextOffset) : undefined;
  return {
    ok: true,
    value: {
      resultId: result.resultId,
      expiresAt: new Date(result.expiresAt).toISOString(),
      nextCursor,
      items,
      summary: result.summary,
    },
  };
}

export function resetBulkResultStoreForTesting(): void {
  store.clear();
  cursors.clear();
}
