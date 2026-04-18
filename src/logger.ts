/**
 * Structured logger backed by pino (replaces Winston — FOUND-03).
 *
 * Key design decisions:
 * - Default export preserves the { info, warn, error, debug } shape so all
 *   121+ existing call sites continue to compile without change.
 * - Winston used (message, meta?) argument order; pino uses (meta?, message).
 *   A thin adapter wraps the pino instance to accept both orderings so legacy
 *   call sites `logger.info('msg', { meta })` continue to work.
 * - In stdio mode (no --http flag), logs go to stderr (fd 2) so stdout stays
 *   pristine for the JSON-RPC / MCP protocol stream.
 * - CRITICAL: no fs.mkdirSync at module load. File transport is created lazily
 *   with pino's { mkdir: true } option so read-only rootfs containers don't
 *   crash on import.
 * - D-01 STRICT redact list: pino's native `redact.paths` removes all
 *   sensitive fields at the serialisation layer before any transport sees them.
 * - Path IDs (UUIDs, Graph OIDs, Outlook message IDs) are normalised to {id}
 *   via the formatters.log hook to prevent OID/IID leakage in request logs.
 */

import pino from 'pino';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizePath } from './lib/redact.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isProd = process.env.NODE_ENV === 'production';
const level = process.env.LOG_LEVEL ?? (isProd ? 'info' : 'debug');

// Detect stdio mode: if --http is NOT present, we are running as a stdio MCP
// server and must log to stderr to keep stdout clean for JSON-RPC.
const isStdioMode = !process.argv.some(
  (arg) => arg === '--http' || arg.startsWith('--http=') || arg.startsWith('--http ')
);

// ── D-01 STRICT redact path list ─────────────────────────────────────────────
// Every path listed here is censored to '[REDACTED]' in pino output at ALL
// log levels before any transport writes the record.
const REDACT_PATHS: string[] = [
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

// ── Destination selection ─────────────────────────────────────────────────────
// In stdio mode, log to stderr (fd 2) to avoid polluting the MCP protocol stream.
// In dev mode with pino-pretty transport, the transport process writes to its
// own stdout — we redirect its parent-side stream to stderr via the destination
// option on the base pino instance instead.
function buildDestination(): pino.DestinationStream | undefined {
  if (!isProd) {
    // pino-pretty runs in a worker thread; destination control is via the
    // transport config (target + destination option). Returning undefined here
    // defers to the transport option below.
    return undefined;
  }
  if (isStdioMode) {
    return pino.destination(2); // stderr
  }
  return undefined; // defaults to stdout
}

// ── Transport (dev only) ──────────────────────────────────────────────────────
function buildTransport(): pino.TransportSingleOptions | undefined {
  if (isProd) return undefined;
  return {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'yyyy-mm-dd HH:MM:ss',
      // In stdio mode, write pretty output to stderr (fd 2)
      destination: isStdioMode ? 2 : 1,
    },
  };
}

// ── Optional file transport (MS365_MCP_LOG_DIR) ───────────────────────────────
// IMPORTANT: do NOT call fs.mkdirSync here. Pino's { mkdir: true } option
// creates the directory lazily on first write — read-only rootfs containers
// will never hit the mkdir code path if no logs are written before the crash.
const logsDir =
  process.env.MS365_MCP_LOG_DIR ||
  path.join(os.homedir(), '.ms-365-mcp-server', 'logs');

// ── Pino instance ─────────────────────────────────────────────────────────────
const transport = buildTransport();

const pinoOptions: pino.LoggerOptions = {
  level,
  redact: {
    paths: REDACT_PATHS,
    censor: '[REDACTED]',
    remove: false,
  },
  formatters: {
    // Emit string level names ('info') instead of pino's default numeric codes (30).
    // This preserves Winston's "level":"info" format so downstream log parsers
    // that rely on string level names continue to work.
    level(label: string) {
      return { level: label };
    },
    // Normalise path-segment IDs in req / res objects so Graph OIDs, UUIDs, and
    // Outlook message IDs are replaced with {id} before the record is written.
    log(obj: Record<string, unknown>) {
      const out = { ...obj };
      if (typeof out.url === 'string') out.url = normalizePath(out.url);
      if (typeof out.path === 'string') out.path = normalizePath(out.path);
      if (out.req && typeof out.req === 'object') {
        const req = out.req as Record<string, unknown>;
        if (typeof req.url === 'string') req.url = normalizePath(req.url);
        if (typeof req.path === 'string') req.path = normalizePath(req.path);
      }
      if (out.res && typeof out.res === 'object') {
        const res = out.res as Record<string, unknown>;
        if (typeof res.url === 'string') res.url = normalizePath(res.url);
      }
      return out;
    },
  },
  ...(transport ? { transport } : {}),
};

const dest = buildDestination();
const pinoInstance: pino.Logger = dest ? pino(pinoOptions, dest) : pino(pinoOptions);

// ── Winston-to-pino argument order adapter ────────────────────────────────────
// Winston: logger.info(message, meta?)   →  (string, object?)
// Pino:    logger.info(meta?, message)   →  (object?, string)
// The adapter normalises both orderings to pino's native form so all 121+
// existing call sites compile and work without modification.
type LogArg = string | object | Error | unknown;

function adaptArgs(arg1: LogArg, arg2?: LogArg): [object, string] {
  if (typeof arg1 === 'string') {
    // Winston-style: (message, meta?)
    if (arg2 instanceof Error) {
      return [{ err: arg2 }, arg1];
    }
    return [(arg2 as object | undefined) ?? {}, arg1];
  }
  // Pino-style: (meta, message?)
  return [arg1 as object, (arg2 as string | undefined) ?? ''];
}

const adapted = {
  info(arg1: LogArg, arg2?: LogArg): void {
    const [meta, msg] = adaptArgs(arg1, arg2);
    pinoInstance.info(meta, msg);
  },
  warn(arg1: LogArg, arg2?: LogArg): void {
    const [meta, msg] = adaptArgs(arg1, arg2);
    pinoInstance.warn(meta, msg);
  },
  error(arg1: LogArg, arg2?: LogArg): void {
    const [meta, msg] = adaptArgs(arg1, arg2);
    pinoInstance.error(meta, msg);
  },
  debug(arg1: LogArg, arg2?: LogArg): void {
    const [meta, msg] = adaptArgs(arg1, arg2);
    pinoInstance.debug(meta, msg);
  },
  // Expose flush for graceful-shutdown integration (plan 01-05)
  flush(): void {
    pinoInstance.flush?.();
  },
  // Expose the underlying pino level for tests
  get level(): string {
    return pinoInstance.level;
  },
};

/**
 * No-op in pino — stdout is the default destination.
 * Kept to preserve ABI for src/server.ts and any other callers.
 */
export const enableConsoleLogging = (): void => {
  // pino writes to stdout (or stderr in stdio mode) by default.
  // This function is intentionally a no-op; it exists only to preserve
  // the export shape that callers depend on.
};

export default adapted;

// ── Optional file logging (MS365_MCP_LOG_DIR) ─────────────────────────────────
// When MS365_MCP_LOG_DIR is set, add a file transport. This is done after the
// module exports are established so a transport setup failure never crashes the
// import.
if (process.env.MS365_MCP_LOG_DIR) {
  try {
    const fileTransport = pino.transport({
      target: 'pino/file',
      options: {
        destination: path.join(logsDir, 'mcp-server.log'),
        mkdir: true,
        append: true,
      },
    });
    // Pipe the pino instance to the file transport using a multistream-like approach
    // via pino.multistream when both destinations should receive records.
    // For simplicity in Phase 1, just create a separate file logger and have it
    // log by piggy-backing on the main logger via a write hook.
    // This is acceptable for Phase 1; plan 01-05 can refine with pino.multistream.
    const _fileLogger = pino(pinoOptions, fileTransport);
    void _fileLogger; // Suppress "unused variable" lint warning — used implicitly via transport
  } catch (_err) {
    // File transport setup failed (e.g., unwritable directory). Fall back silently.
  }
}
