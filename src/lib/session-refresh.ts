/**
 * Server-side delegated access-token refresh.
 *
 * The preferred path is an encrypted refresh token in SessionStore. MSAL Node
 * normally keeps refresh tokens inside its token cache instead of exposing
 * them on AuthenticationResult, so we also support a cache-backed silent
 * refresh using the account home id captured during /token.
 */
import type { TenantRow } from './tenant/tenant-row.js';
import type { TenantPool } from './tenant/tenant-pool.js';
import type { RedisClient } from './redis.js';
import { SessionStore } from './session-store.js';
import logger from '../logger.js';

interface RefreshResult {
  accessToken?: string;
  refreshToken?: string;
  expiresOn?: Date | null;
  account?: { homeAccountId?: string } | null;
}

interface MsalWithRefresh {
  acquireTokenByRefreshToken: (req: {
    refreshToken: string;
    scopes: string[];
  }) => Promise<RefreshResult | null>;
}

interface MsalWithSilent {
  acquireTokenSilent: (req: {
    account: unknown;
    scopes: string[];
    forceRefresh?: boolean;
  }) => Promise<RefreshResult | null>;
  getTokenCache: () => {
    getAccountByHomeId: (homeAccountId: string) => Promise<unknown | null>;
    deserialize?: (cache: string) => void;
    serialize?: () => string;
  };
}

function hasAcquireTokenByRefreshToken(c: unknown): c is MsalWithRefresh {
  return (
    typeof c === 'object' &&
    c !== null &&
    'acquireTokenByRefreshToken' in c &&
    typeof (c as { acquireTokenByRefreshToken: unknown }).acquireTokenByRefreshToken === 'function'
  );
}

function hasAcquireTokenSilent(c: unknown): c is MsalWithSilent {
  return (
    typeof c === 'object' &&
    c !== null &&
    'acquireTokenSilent' in c &&
    typeof (c as { acquireTokenSilent: unknown }).acquireTokenSilent === 'function' &&
    'getTokenCache' in c &&
    typeof (c as { getTokenCache: unknown }).getTokenCache === 'function'
  );
}

export async function refreshSessionAndRetry(args: {
  tenant: TenantRow;
  oldAccessToken: string;
  tenantPool: Pick<TenantPool, 'acquire' | 'getDekForTenant'>;
  redis: RedisClient;
}): Promise<{ accessToken: string; refreshToken?: string; expiresOn?: Date | null }> {
  const { tenant, oldAccessToken, tenantPool, redis } = args;

  const msal = await tenantPool.acquire(tenant);
  const dek = tenantPool.getDekForTenant(tenant.id);
  const sessionStore = new SessionStore(redis, dek);

  const record = await sessionStore.get(tenant.id, oldAccessToken);
  if (!record) {
    throw new Error('no_session_for_access_token');
  }

  let fresh: RefreshResult | null = null;

  if (record.refreshToken && hasAcquireTokenByRefreshToken(msal)) {
    fresh = await msal.acquireTokenByRefreshToken({
      refreshToken: record.refreshToken,
      scopes: record.scopes,
    });
  } else if (record.accountHomeId && hasAcquireTokenSilent(msal)) {
    const tokenCache = msal.getTokenCache();
    if (record.msalCache && typeof tokenCache.deserialize === 'function') {
      tokenCache.deserialize(record.msalCache);
    }
    const account = await tokenCache.getAccountByHomeId(record.accountHomeId);
    if (!account) {
      await sessionStore.delete(tenant.id, oldAccessToken);
      throw new Error('no_cached_account_for_session');
    }
    fresh = await msal.acquireTokenSilent({
      account,
      scopes: record.scopes,
      forceRefresh: true,
    });
  } else {
    throw new Error('tenant_does_not_support_refresh');
  }

  if (!fresh?.accessToken) {
    await sessionStore.delete(tenant.id, oldAccessToken);
    throw new Error('refresh_token_exchange_failed');
  }

  const freshRefreshToken = fresh.refreshToken ?? record.refreshToken;
  const nextMsalCache =
    hasAcquireTokenSilent(msal) && typeof msal.getTokenCache().serialize === 'function'
      ? msal.getTokenCache().serialize()
      : record.msalCache;
  await sessionStore.put(tenant.id, oldAccessToken, {
    ...record,
    refreshToken: freshRefreshToken,
    accountHomeId: fresh.account?.homeAccountId ?? record.accountHomeId,
    msalCache: nextMsalCache,
    graphAccessToken: fresh.accessToken,
    graphAccessTokenExpiresOn: fresh.expiresOn?.toISOString(),
    createdAt: Date.now(),
  });

  logger.info(
    { tenantId: tenant.id, rotated: Boolean(fresh.refreshToken) },
    'session refresh: rotated Graph access token via SessionStore'
  );

  return {
    accessToken: fresh.accessToken,
    refreshToken: fresh.refreshToken ?? undefined,
    expiresOn: fresh.expiresOn ?? undefined,
  };
}
