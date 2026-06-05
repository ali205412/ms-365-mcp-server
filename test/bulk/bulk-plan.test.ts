import { describe, expect, it } from 'vitest';
import { requestContext } from '../../src/request-context.js';
import { buildBulkPlan, bulkPlanPublicSummary } from '../../src/lib/bulk-actions/plan.js';
import {
  BULK_ACTION_TOOL,
  READ_BULK_RESULT_TOOL,
  type BulkActionInput,
} from '../../src/lib/bulk-actions/schema.js';

function runWithTenant<T>(enabled: string[], fn: () => T): T {
  return requestContext.run(
    {
      tenantId: 'tenant-a',
      enabledToolsSet: new Set(enabled),
      enabledToolsExplicit: true,
      presetVersion: 'custom',
      ownerSubject: 'owner-a',
    },
    fn
  );
}

describe('bulk action planner', () => {
  it('accepts public single-tool OData string parameter overrides', () => {
    const plan = runWithTenant([BULK_ACTION_TOOL, READ_BULK_RESULT_TOOL, 'get-chat'], () =>
      buildBulkPlan(
        {
          mode: 'preview',
          outputMode: 'summary',
          items: [
            {
              id: 'read-1',
              toolName: 'get-chat',
              parameters: { chatId: 'secret-chat-id', select: 'id,topic' },
            },
          ],
        },
        { readOnly: false, orgMode: true, now: new Date('2026-06-05T00:00:00Z') }
      )
    );
    expect('error' in plan).toBe(false);
    if ('error' in plan) return;
    expect(plan.items[0]).toMatchObject({ status: 'allowed' });
    expect(plan.executionParameters.get('read-1')).toMatchObject({ select: 'id,topic' });
  });

  it('accepts numeric and boolean public OData controls', () => {
    const plan = runWithTenant([BULK_ACTION_TOOL, READ_BULK_RESULT_TOOL, 'list-chats'], () =>
      buildBulkPlan(
        {
          mode: 'preview',
          outputMode: 'summary',
          items: [
            {
              id: 'list-1',
              toolName: 'list-chats',
              parameters: { top: 5, count: true },
            },
          ],
        },
        { readOnly: false, orgMode: true, now: new Date('2026-06-05T00:00:00Z') }
      )
    );
    expect('error' in plan).toBe(false);
    if ('error' in plan) return;
    expect(plan.items[0]).toMatchObject({ status: 'allowed' });
    expect(plan.executionParameters.get('list-1')).toMatchObject({ top: 5, count: true });
  });

  it('documents intentional strict unknown parameter rejection for bulk safety', () => {
    const plan = runWithTenant([BULK_ACTION_TOOL, 'get-chat'], () =>
      buildBulkPlan(
        {
          mode: 'preview',
          outputMode: 'summary',
          items: [
            { id: 'read-1', toolName: 'get-chat', parameters: { chatId: 'a', unknown: 'ignored' } },
          ],
        },
        { readOnly: false, orgMode: true, now: new Date('2026-06-05T00:00:00Z') }
      )
    );
    expect('error' in plan).toBe(false);
    if ('error' in plan) return;
    expect(plan.items[0]).toMatchObject({ status: 'invalid', code: 'parameter_validation_failed' });
  });

  it('previews generated aliases without exposing raw parameter values', () => {
    const plan = runWithTenant([BULK_ACTION_TOOL, READ_BULK_RESULT_TOOL, 'get-chat'], () =>
      buildBulkPlan(
        {
          mode: 'preview',
          outputMode: 'summary',
          items: [
            {
              id: 'read-1',
              toolName: 'get-chat',
              parameters: { chatId: 'secret-chat-id', select: ['id'] },
            },
          ],
        },
        { readOnly: false, orgMode: true, now: new Date('2026-06-05T00:00:00Z') }
      )
    );
    expect('error' in plan).toBe(false);
    if ('error' in plan) return;
    expect(plan.items[0]).toMatchObject({ id: 'read-1', toolName: 'get-chat', status: 'allowed' });
    const summary = bulkPlanPublicSummary(plan);
    expect(JSON.stringify(summary)).not.toContain('secret-chat-id');
    expect(JSON.stringify(summary)).toContain('parameterHash');
  });

  it('blocks raw request shapes and duplicate ids before execution', () => {
    const plan = runWithTenant([BULK_ACTION_TOOL, 'get-chat'], () =>
      buildBulkPlan(
        {
          mode: 'preview',
          outputMode: 'summary',
          items: [
            { id: 'dup', toolName: 'get-chat', parameters: { chatId: 'a' } },
            { id: 'dup', toolName: 'get-chat', parameters: { chatId: 'b' } },
            { id: 'raw', toolName: 'get-chat', parameters: { url: '/me' } },
          ],
        },
        { readOnly: false, orgMode: true, now: new Date('2026-06-05T00:00:00Z') }
      )
    );
    expect('error' in plan).toBe(false);
    if ('error' in plan) return;
    expect(plan.items.map((item) => item.code)).toEqual([
      undefined,
      'duplicate_item_id',
      'forbidden_raw_request_shape',
    ]);
  });

  it('reports read-only write policy instead of unknown tool', () => {
    const plan = runWithTenant([BULK_ACTION_TOOL, 'delete-onedrive-file'], () =>
      buildBulkPlan(
        {
          mode: 'preview',
          outputMode: 'summary',
          items: [
            {
              id: 'write-1',
              toolName: 'delete-onedrive-file',
              parameters: { driveId: 'drive-id', driveItemId: 'item-id' },
            },
          ],
        },
        { readOnly: true, orgMode: true, now: new Date('2026-06-05T00:00:00Z') }
      )
    );
    expect('error' in plan).toBe(false);
    if ('error' in plan) return;
    expect(plan.items[0]).toMatchObject({ status: 'blocked', code: 'read_only_violation' });
  });

  it('keeps preview and execute digest stable when execute reuses preview expiry', () => {
    const previewInput: BulkActionInput = {
      mode: 'preview',
      outputMode: 'summary',
      items: [{ id: 'read-1', toolName: 'get-chat', parameters: { chatId: 'same' } }],
    };
    const preview = runWithTenant([BULK_ACTION_TOOL, 'get-chat'], () =>
      buildBulkPlan(previewInput, {
        readOnly: false,
        orgMode: true,
        now: new Date('2026-06-05T00:00:00Z'),
      })
    );
    expect('error' in preview).toBe(false);
    if ('error' in preview) return;
    const execute = runWithTenant([BULK_ACTION_TOOL, 'get-chat'], () =>
      buildBulkPlan(
        {
          ...previewInput,
          mode: 'execute',
          confirmation: {
            planDigest: preview.planDigest,
            confirmed: true,
            expiresAt: preview.expiresAt,
          },
        },
        { readOnly: false, orgMode: true, now: new Date('2026-06-05T00:01:00Z') }
      )
    );
    expect('error' in execute).toBe(false);
    if ('error' in execute) return;
    expect(execute.planDigest).toBe(preview.planDigest);
  });
});
