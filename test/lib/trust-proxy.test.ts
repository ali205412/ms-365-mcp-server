import { describe, expect, it } from 'vitest';
import { resolveTrustProxySetting } from '../../src/lib/trust-proxy.js';

describe('resolveTrustProxySetting', () => {
  it('defaults to false so direct clients cannot spoof forwarded headers', () => {
    expect(resolveTrustProxySetting(undefined)).toBe(false);
    expect(resolveTrustProxySetting('')).toBe(false);
    expect(resolveTrustProxySetting('0')).toBe(false);
    expect(resolveTrustProxySetting('false')).toBe(false);
  });

  it('supports explicit hop counts and CIDR/subnet strings', () => {
    expect(resolveTrustProxySetting('1')).toBe(1);
    expect(resolveTrustProxySetting('true')).toBe(1);
    expect(resolveTrustProxySetting('2')).toBe(2);
    expect(resolveTrustProxySetting('loopback')).toBe('loopback');
    expect(resolveTrustProxySetting('10.0.0.0/8')).toBe('10.0.0.0/8');
  });
});
