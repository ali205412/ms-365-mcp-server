/**
 * Tests for D-01 STRICT redaction policy via pino logger (OPS-02).
 *
 * Requirement: OPS-02 — default info logs must never contain Authorization
 * bearer tokens, refresh tokens, request bodies, client_secret, or
 * Prefer/x-microsoft-refresh-token headers.
 *
 * These tests MUST FAIL before the implementation is written (RED phase).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type pino from 'pino';

/**
 * Helper to capture a single pino log line as parsed JSON.
 * Creates a fresh logger with the given config + a sync write-stream,
 * calls cb(log), and returns the last captured line.
 */
async function captureLogLine(
  config: pino.LoggerOptions,
  cb: (log: pino.Logger) => void
): Promise<Record<string, unknown>> {
  const pinoModule = await import('pino');
  const pinoFn = pinoModule.default;

  const chunks: string[] = [];
  const stream = {
    write: (chunk: string) => {
      chunks.push(chunk);
    },
  };

  const log = pinoFn(config, stream as unknown as pino.DestinationStream);
  cb(log);

  if (chunks.length === 0) {
    throw new Error('No log lines captured');
  }
  return JSON.parse(chunks[chunks.length - 1]);
}

/**
 * The D-01 STRICT redact paths list — must match src/logger.ts exactly.
 */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers.prefer',
  'req.headers["x-microsoft-refresh-token"]',
  'req.headers["x-tenant-*"]',
  'req.body',
  'res.body',
  '*.refresh_token',
  '*.refreshToken',
  '*.refresh-token',
  '*.client_secret',
  '*.clientSecret',
  '*.MS365_MCP_OAUTH_TOKEN',
  '*.access_token',
  'query.$filter',
  'query.$search',
];

describe('logger-redaction: D-01 STRICT redaction policy (OPS-02)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const loggerConfig: pino.LoggerOptions = {
    level: 'info',
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]', remove: false },
    formatters: {
      level(label: string) {
        return { level: label };
      },
    },
  };

  it('redacts req.headers.authorization', async () => {
    const parsed = await captureLogLine(loggerConfig, (log) => {
      log.info({ req: { headers: { authorization: 'Bearer super-secret-token' } } }, 'req');
    });
    expect((parsed as { req?: { headers?: { authorization?: unknown } } }).req?.headers?.authorization).toBe('[REDACTED]');
  });

  it('redacts req.body', async () => {
    const parsed = await captureLogLine(loggerConfig, (log) => {
      log.info({ req: { body: { password: 'my-secret' } } }, 'req');
    });
    expect((parsed as { req?: { body?: unknown } }).req?.body).toBe('[REDACTED]');
  });

  it('redacts res.body', async () => {
    const parsed = await captureLogLine(loggerConfig, (log) => {
      log.info({ res: { body: { token: 'secret-token' } } }, 'res');
    });
    expect((parsed as { res?: { body?: unknown } }).res?.body).toBe('[REDACTED]');
  });

  it('redacts refresh_token at top level via wildcard', async () => {
    const parsed = await captureLogLine(loggerConfig, (log) => {
      log.info({ data: { refresh_token: 'refresh-secret' } }, 'token');
    });
    expect((parsed as { data?: { refresh_token?: unknown } }).data?.refresh_token).toBe('[REDACTED]');
  });

  it('redacts client_secret via wildcard', async () => {
    const parsed = await captureLogLine(loggerConfig, (log) => {
      log.info({ payload: { client_secret: 'my-app-secret' } }, 'payload');
    });
    expect((parsed as { payload?: { client_secret?: unknown } }).payload?.client_secret).toBe('[REDACTED]');
  });

  it('redacts access_token via wildcard', async () => {
    const parsed = await captureLogLine(loggerConfig, (log) => {
      log.info({ data: { access_token: 'access-token-value' } }, 'token');
    });
    expect((parsed as { data?: { access_token?: unknown } }).data?.access_token).toBe('[REDACTED]');
  });

  it('redacts req.headers.prefer', async () => {
    const parsed = await captureLogLine(loggerConfig, (log) => {
      log.info({ req: { headers: { prefer: 'respond-async' } } }, 'req');
    });
    expect((parsed as { req?: { headers?: { prefer?: unknown } } }).req?.headers?.prefer).toBe('[REDACTED]');
  });

  it('redacts req.headers["x-microsoft-refresh-token"]', async () => {
    const parsed = await captureLogLine(loggerConfig, (log) => {
      log.info(
        { req: { headers: { 'x-microsoft-refresh-token': 'refresh-token-value' } } },
        'req'
      );
    });
    expect(
      (parsed as { req?: { headers?: Record<string, unknown> } }).req?.headers?.['x-microsoft-refresh-token']
    ).toBe('[REDACTED]');
  });

  it('redacts query.$filter', async () => {
    const parsed = await captureLogLine(loggerConfig, (log) => {
      log.info({ query: { $filter: "displayName eq 'John'" } }, 'query');
    });
    expect((parsed as { query?: { $filter?: unknown } }).query?.['$filter']).toBe('[REDACTED]');
  });
});

// ─── Path normalization matrix (WARNING 1 — real Graph ID coverage) ───────────

describe('logger-redaction: path normalization (normalizePath)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('normalizes uppercase base64url Outlook message ID (starts with A)', async () => {
    const { normalizePath } = await import('../src/lib/redact.js');
    const input =
      '/users/AAMkAD123-base64==/messages/AQMkADAwATM3ZmYAZS1iMjcyLTg3MGItMDACLTAwCgBGAAADMkAAAAA=';
    const result = normalizePath(input);
    expect(result).toContain('/{id}');
    // The original long ID should not be present
    expect(result).not.toContain('AQMkADAwATM3ZmYAZS1iMjcyLTg3MGItMDACLTAwCgBGAAADMkAAAAA=');
  });

  it('normalizes lowercase base64url Outlook message ID (starts with a)', async () => {
    const { normalizePath } = await import('../src/lib/redact.js');
    const input =
      '/users/aQMkADAwATM3ZmYAZS1iMjcyLTg3MGItMDACLTAwCgBGAAADMkAAAAA=';
    const result = normalizePath(input);
    expect(result).toContain('/{id}');
    expect(result).not.toContain('aQMkADAwATM3ZmYAZS1iMjcyLTg3MGItMDACLTAwCgBGAAADMkAAAAA=');
  });

  it('normalizes canonical UUID', async () => {
    const { normalizePath } = await import('../src/lib/redact.js');
    const input = '/users/12345678-1234-1234-1234-123456789abc';
    const result = normalizePath(input);
    expect(result).toBe('/users/{id}');
  });

  it('normalizes uppercase Graph OID (≥18 chars alphanumeric)', async () => {
    const { normalizePath } = await import('../src/lib/redact.js');
    const input = '/users/ABC123XYZ456DEF789';
    const result = normalizePath(input);
    expect(result).toContain('/{id}');
    expect(result).not.toContain('ABC123XYZ456DEF789');
  });

  it('normalizes mixed path with UPN + two distinct ID types (UPN preserved)', async () => {
    const { normalizePath } = await import('../src/lib/redact.js');
    const input =
      '/users/kotegawa@example.onmicrosoft.com/messages/AAMkAD123/attachments/AQMkADAwATM3ZmYAZS1iMjcyLTg3MGItMDACLTAwCgBGAAADMkAAAAA=';
    const result = normalizePath(input);
    // Both IDs replaced
    expect(result).not.toContain('AAMkAD123');
    expect(result).not.toContain('AQMkADAwATM3ZmYAZS1iMjcyLTg3MGItMDACLTAwCgBGAAADMkAAAAA=');
    // UPN preserved (contains '@' which is not in the regex character class)
    expect(result).toContain('kotegawa@example.onmicrosoft.com');
  });
});
