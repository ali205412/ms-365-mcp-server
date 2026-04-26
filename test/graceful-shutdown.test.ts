/**
 * Tests for graceful shutdown orchestration (OPS-09 / plan 01-05).
 *
 * registerShutdownHooks(server, logger) must:
 *   - Register SIGTERM AND SIGINT handlers on process.
 *   - On signal: flip setDraining(true), server.close() await, logger.flush?(),
 *     otel.shutdown() with 10s race, process.exit(0).
 *   - Idempotent: second signal while first is in-flight is a no-op.
 *   - Stdio mode: null server argument skips server.close().
 *   - If otel.shutdown hangs past 10s, exit(0) still runs.
 *
 * Threat refs from plan 01-05 <threat_model>:
 *   - T-01-05a: SIGTERM -> setDraining(true) -> drain sequence
 *   - T-01-05b: OTel shutdown wrapped in 10s Promise.race (collector hang defense)
 *   - T-01-05c: logger.flush? runs on final exit (try/catch wrapped)
 *   - T-01-05d: Double SIGTERM is idempotent via isDraining guard
 *
 * These tests MUST FAIL before src/lib/shutdown.ts is implemented (RED phase).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock otel bootstrap so tests never touch real OTel SDK state.
vi.mock('../src/lib/otel.js', () => ({
  otel: {
    sdk: {},
    shutdown: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock health so we can inspect setDraining + control isDraining behavior.
vi.mock('../src/lib/health.js', () => ({
  isDraining: vi.fn(() => false),
  setDraining: vi.fn(),
}));

// Reusable signal-handler registry captured via vi.spyOn(process, 'on').
type SignalHandler = (signal: string) => void | Promise<void>;

function installProcessSpies(): {
  handlers: Record<string, SignalHandler>;
  exitSpy: ReturnType<typeof vi.spyOn>;
} {
  const handlers: Record<string, SignalHandler> = {};

  // Capture process.on registrations so we can invoke them directly.
  vi.spyOn(process, 'on').mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ev: any, h: any) => {
      handlers[ev as string] = h;
      return process;
    }
  );

  // Task 3 adds removeAllListeners guard; tolerate it here.
  vi.spyOn(process, 'removeAllListeners').mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ev: any) => {
      if (ev) {
        delete handlers[ev as string];
      }
      return process;
    }
  );

  // process.exit must never actually exit the test process.
  const exitSpy = vi
    .spyOn(process, 'exit')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockImplementation(((_code?: number) => undefined) as any);

  return { handlers, exitSpy };
}

function makeStubServer() {
  return {
    close: vi.fn((cb?: (err?: Error) => void) => {
      // Express / http.Server.close accepts an optional callback fired once
      // all in-flight connections are closed. Invoke it synchronously for the
      // test so the await promise resolves deterministically.
      if (typeof cb === 'function') cb();
    }),
  };
}

function makeStubLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    flush: vi.fn(),
  };
}

describe('graceful shutdown (OPS-09 / plan 01-05)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('Test 1: shutdown handler flips isDraining via setDraining(true)', async () => {
    const { handlers } = installProcessSpies();
    const health = await import('../src/lib/health.js');

    const server = makeStubServer();
    const logger = makeStubLogger();

    const { registerShutdownHooks } = await import('../src/lib/shutdown.js');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerShutdownHooks(server as any, logger as any);

    await handlers['SIGTERM']('SIGTERM');

    expect(health.setDraining).toHaveBeenCalledWith(true);
  });

  it('Test 2: shutdown handler calls logger.flush when present', async () => {
    const { handlers } = installProcessSpies();

    const server = makeStubServer();
    const logger = makeStubLogger();

    const { registerShutdownHooks } = await import('../src/lib/shutdown.js');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerShutdownHooks(server as any, logger as any);

    await handlers['SIGTERM']('SIGTERM');

    expect(logger.flush).toHaveBeenCalled();
  });

  it('Test 3: shutdown handler calls otel.shutdown exactly once', async () => {
    const { handlers } = installProcessSpies();
    const otelMod = await import('../src/lib/otel.js');

    const server = makeStubServer();
    const logger = makeStubLogger();

    const { registerShutdownHooks } = await import('../src/lib/shutdown.js');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerShutdownHooks(server as any, logger as any);

    await handlers['SIGTERM']('SIGTERM');

    expect(otelMod.otel.shutdown).toHaveBeenCalledTimes(1);
  });

  it('Test 4: shutdown handler calls server.close once when server is non-null', async () => {
    const { handlers } = installProcessSpies();

    const server = makeStubServer();
    const logger = makeStubLogger();

    const { registerShutdownHooks } = await import('../src/lib/shutdown.js');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerShutdownHooks(server as any, logger as any);

    await handlers['SIGTERM']('SIGTERM');

    expect(server.close).toHaveBeenCalledTimes(1);
  });

  it('Test 5: shutdown handler skips server.close when server is null (stdio mode)', async () => {
    const { handlers } = installProcessSpies();

    const logger = makeStubLogger();

    const { registerShutdownHooks } = await import('../src/lib/shutdown.js');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerShutdownHooks(null, logger as any);

    // Should not throw and should still run the rest of the sequence.
    await handlers['SIGTERM']('SIGTERM');

    // Just proving no server.close invocation would be a noop — but the key
    // behavior is that the handler completes without throwing.
    // Check that otel.shutdown still ran (proves handler continued past the
    // skipped server.close branch).
    const otelMod = await import('../src/lib/otel.js');
    expect(otelMod.otel.shutdown).toHaveBeenCalled();
  });

  it('Test 6: double invocation is idempotent — server.close called only once', async () => {
    const { handlers } = installProcessSpies();
    const health = await import('../src/lib/health.js');

    // First call: not draining yet. Second call: draining from prior run.
    vi.mocked(health.isDraining).mockReturnValueOnce(false).mockReturnValueOnce(true);

    const server = makeStubServer();
    const logger = makeStubLogger();

    const { registerShutdownHooks } = await import('../src/lib/shutdown.js');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerShutdownHooks(server as any, logger as any);

    // Two signals fired back-to-back.
    await handlers['SIGTERM']('SIGTERM');
    await handlers['SIGTERM']('SIGTERM');

    expect(server.close).toHaveBeenCalledTimes(1);
  });

  it('Test 7: otel.shutdown hang past 10s still lets process.exit(0) run (Promise.race timeout)', async () => {
    const { handlers, exitSpy } = installProcessSpies();
    const otelMod = await import('../src/lib/otel.js');

    // Make otel.shutdown hang indefinitely.
    vi.mocked(otelMod.otel.shutdown).mockReturnValue(new Promise<void>(() => {}));

    vi.useFakeTimers();

    const server = makeStubServer();
    const logger = makeStubLogger();

    const { registerShutdownHooks } = await import('../src/lib/shutdown.js');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerShutdownHooks(server as any, logger as any);

    // Kick the handler — it will await server.close (resolves immediately),
    // then await Promise.race([otel.shutdown(), 10s timeout]).
    const p = handlers['SIGTERM']('SIGTERM');

    // Advance fake time past the 10s OTel race ceiling.
    await vi.advanceTimersByTimeAsync(11_000);

    await p;

    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('Test 8: registerShutdownHooks registers both SIGTERM and SIGINT on process', async () => {
    const { handlers } = installProcessSpies();

    const server = makeStubServer();
    const logger = makeStubLogger();

    const { registerShutdownHooks } = await import('../src/lib/shutdown.js');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerShutdownHooks(server as any, logger as any);

    expect(handlers['SIGTERM']).toBeDefined();
    expect(handlers['SIGINT']).toBeDefined();
    expect(typeof handlers['SIGTERM']).toBe('function');
    expect(typeof handlers['SIGINT']).toBe('function');
  });

  it('Test 9: multiple registered HTTP servers are closed by one signal', async () => {
    const { handlers } = installProcessSpies();

    const mainServer = makeStubServer();
    const metricsServer = makeStubServer();
    const logger = makeStubLogger();

    const { registerShutdownHooks } = await import('../src/lib/shutdown.js');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerShutdownHooks(mainServer as any, logger as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerShutdownHooks(metricsServer as any, logger as any);

    await handlers['SIGTERM']('SIGTERM');

    expect(mainServer.close).toHaveBeenCalledTimes(1);
    expect(metricsServer.close).toHaveBeenCalledTimes(1);
  });
});
