export type TrustProxySetting = false | true | number | string;

/**
 * Express `trust proxy` resolver.
 *
 * Default is false so direct clients cannot spoof X-Forwarded-* audit fields.
 * Set MS365_MCP_TRUST_PROXY to:
 *   - 1/true: trust one proxy hop
 *   - a positive integer: trust that many hops
 *   - a CIDR/subnet string accepted by Express, e.g. loopback, 10.0.0.0/8
 */
export function resolveTrustProxySetting(
  raw = process.env.MS365_MCP_TRUST_PROXY
): TrustProxySetting {
  const normalized = raw?.trim();
  if (
    normalized === undefined ||
    normalized === '' ||
    normalized === '0' ||
    normalized.toLowerCase() === 'false'
  ) {
    return false;
  }
  if (normalized === '1' || normalized.toLowerCase() === 'true') {
    return 1;
  }
  if (/^[1-9]\d*$/.test(normalized)) {
    return Number.parseInt(normalized, 10);
  }
  return normalized;
}
