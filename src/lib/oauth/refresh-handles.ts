import crypto from 'node:crypto';
import type { RedisClient } from '../redis.js';
import { hashAccessToken, type SessionRecord, type SessionStore } from '../session-store.js';

const DEFAULT_TTL_SECONDS = 14 * 24 * 60 * 60;

export interface GatewayRefreshSession {
  accessTokenHash: string;
  record: SessionRecord;
}

export function mintGatewayRefreshToken(): string {
  return `mcp_rt_${crypto.randomBytes(32).toString('base64url')}`;
}

function hashRefreshToken(refreshToken: string): string {
  return crypto.createHash('sha256').update(refreshToken).digest('hex');
}

function refreshKey(tenantId: string, refreshToken: string): string {
  return `mcp:refresh:${tenantId}:${hashRefreshToken(refreshToken)}`;
}

function legacyRefreshKey(tenantId: string, refreshToken: string): string {
  return `mcp:session:${tenantId}:refresh:${hashRefreshToken(refreshToken)}`;
}

function refreshRotationLockKey(tenantId: string, refreshToken: string): string {
  return `mcp:refresh-lock:${tenantId}:${hashRefreshToken(refreshToken)}`;
}

function resolveTtl(): number {
  const raw = process.env.MS365_MCP_SESSION_TTL_SECONDS;
  if (!raw) return DEFAULT_TTL_SECONDS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_SECONDS;
}

async function getRefreshHandle(args: {
  redis: RedisClient;
  tenantId: string;
  refreshToken: string;
  consume: boolean;
}): Promise<string | null> {
  const read = args.consume ? args.redis.getdel.bind(args.redis) : args.redis.get.bind(args.redis);
  const current = await read(refreshKey(args.tenantId, args.refreshToken));
  if (current) return current;

  // Backward compatibility for refresh handles issued before the plaintext fix.
  // Consumption migrates the client onto the safe mcp:refresh:* namespace.
  return await read(legacyRefreshKey(args.tenantId, args.refreshToken));
}

async function resolveRefreshSession(args: {
  redis: RedisClient;
  sessionStore: SessionStore;
  tenantId: string;
  refreshToken: string;
  consume: boolean;
}): Promise<GatewayRefreshSession | null> {
  const raw = await getRefreshHandle(args);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as { accessTokenHash?: string; accessToken?: string };
  const accessTokenHash =
    parsed.accessTokenHash ??
    (parsed.accessToken ? hashAccessToken(parsed.accessToken) : undefined);
  if (!accessTokenHash) return null;
  const record = await args.sessionStore.getByAccessTokenHash(args.tenantId, accessTokenHash);
  return record ? { accessTokenHash, record } : null;
}

export async function storeGatewayRefreshToken(args: {
  redis: RedisClient;
  tenantId: string;
  refreshToken: string;
  accessToken: string;
}): Promise<void> {
  await args.redis.set(
    refreshKey(args.tenantId, args.refreshToken),
    JSON.stringify({ accessTokenHash: hashAccessToken(args.accessToken) }),
    'EX',
    resolveTtl()
  );
}

export async function lookupGatewayRefreshSession(args: {
  redis: RedisClient;
  sessionStore: SessionStore;
  tenantId: string;
  refreshToken: string;
}): Promise<GatewayRefreshSession | null> {
  return await resolveRefreshSession({ ...args, consume: false });
}

export async function consumeGatewayRefreshSession(args: {
  redis: RedisClient;
  sessionStore: SessionStore;
  tenantId: string;
  refreshToken: string;
}): Promise<GatewayRefreshSession | null> {
  return await resolveRefreshSession({ ...args, consume: true });
}

export async function revokeGatewayRefreshToken(args: {
  redis: RedisClient;
  tenantId: string;
  refreshToken: string;
}): Promise<void> {
  await args.redis.del(
    refreshKey(args.tenantId, args.refreshToken),
    legacyRefreshKey(args.tenantId, args.refreshToken)
  );
}

export async function acquireGatewayRefreshRotationLock(args: {
  redis: RedisClient;
  tenantId: string;
  refreshToken: string;
  lockId: string;
  ttlMs?: number;
}): Promise<boolean> {
  const result = await args.redis.set(
    refreshRotationLockKey(args.tenantId, args.refreshToken),
    args.lockId,
    'PX',
    args.ttlMs ?? 30_000,
    'NX'
  );
  return result === 'OK';
}

export async function releaseGatewayRefreshRotationLock(args: {
  redis: RedisClient;
  tenantId: string;
  refreshToken: string;
  lockId: string;
}): Promise<void> {
  const key = refreshRotationLockKey(args.tenantId, args.refreshToken);
  const current = await args.redis.get(key);
  if (current === args.lockId) {
    await args.redis.del(key);
  }
}
