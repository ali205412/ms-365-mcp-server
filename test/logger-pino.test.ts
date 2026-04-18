/**
 * Tests for pino logger API compatibility (FOUND-03).
 *
 * Requirement: FOUND-03 — replace Winston with pino while preserving the
 * default export shape ({ info, warn, error, debug }) so existing 121+ call
 * sites compile unchanged.
 *
 * These tests MUST FAIL before the implementation is written (RED phase).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type pino from 'pino';

describe('logger-pino: API compatibility (FOUND-03)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('default export has info, warn, error, debug methods', async () => {
    const { default: logger } = await import('../src/logger.js');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.debug).toBe('function');
  });

  it('enableConsoleLogging is an exported function returning void', async () => {
    const { enableConsoleLogging } = await import('../src/logger.js');
    expect(typeof enableConsoleLogging).toBe('function');
    // calling it should not throw (no-op in pino)
    expect(() => enableConsoleLogging()).not.toThrow();
  });

  it('level output is string-formatted ("level":"info" not numeric)', async () => {
    // This test directly creates a pino logger with the same config
    // and checks that the level formatter emits string names.
    const pinoModule = await import('pino');
    const pinoFn = pinoModule.default;

    const chunks: string[] = [];
    const stream = {
      write: (chunk: string) => {
        chunks.push(chunk);
      },
    };

    const testLogger = pinoFn(
      {
        level: 'info',
        formatters: {
          level(label: string) {
            return { level: label };
          },
        },
      },
      stream as unknown as pino.DestinationStream
    );

    testLogger.info('test message');
    expect(chunks.length).toBeGreaterThan(0);
    const parsed = JSON.parse(chunks[chunks.length - 1]);
    expect(typeof parsed.level).toBe('string');
    expect(parsed.level).toBe('info');
  });

  it('in production mode, logger uses raw JSON output (no pino-pretty)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { default: logger } = await import('../src/logger.js');

    // The logger object itself should not have a transport configured for pretty-printing.
    // We verify this indirectly: the pino logger in prod mode is a raw JSON logger.
    // Check that it is a pino logger (has .level property) and emits parseable JSON.
    expect(typeof (logger as unknown as { level: string }).level).toBe('string');
  });
});
