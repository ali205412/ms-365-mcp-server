/**
 * Parse `--http` CLI flag / MS365_MCP_HTTP env var into { host, port }.
 *
 * Extracted from src/server.ts so src/index.ts can import it without
 * transitively loading the full server module (which pulls in the ~45 MB
 * src/generated/client.ts). Keeps the fail-fast validation path (plan 01-07
 * SECUR-04) fast enough to exit before spawnSync-based startup tests hit
 * their 10 s timeout.
 *
 * Supports formats: "host:port", ":port", "port"
 */
export function parseHttpOption(httpOption: string | boolean): {
  host: string | undefined;
  port: number;
} {
  if (typeof httpOption === 'boolean') {
    return { host: undefined, port: 3000 };
  }

  const httpString = httpOption.trim();

  if (httpString.includes(':')) {
    const [hostPart, portPart] = httpString.split(':');
    const host = hostPart || undefined;
    const port = parseInt(portPart) || 3000;
    return { host, port };
  }

  const port = parseInt(httpString) || 3000;
  return { host: undefined, port };
}
