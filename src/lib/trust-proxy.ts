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
  if (raw === undefined || raw === '' || raw === '0' || raw.toLowerCase() === 'false') {
    return false;
  }
  if (raw === '1' || raw.toLowerCase() === 'true') {
    return 1;
  }
  if (/^[1-9]\d*$/.test(raw)) {
    return Number.parseInt(raw, 10);
  }
  return raw;
}
