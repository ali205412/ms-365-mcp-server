import crypto from 'node:crypto';
import type { RedisClient } from '../redis.js';
import { hashAccessToken, type SessionRecord, type SessionStore } from '../session-store.js';

const DEFAULT_TTL_SECONDS = 14 * 24 * 60 * 60;

export interface GatewayRefreshSession {
  accessToken: string;
  record: SessionRecord;
}

export function mintGatewayRefreshToken(): string {
  return `mcp_rt_${crypto.randomBytes(32).toString('base64url')}`;
}

function hashRefreshToken(refreshToken: string): string {
  return crypto.createHash('sha256').update(refreshToken).digest('hex');
}

function refreshKey(tenantId: string, refreshToken: string): string {
  return `mcp:session:${tenantId}:refresh:${hashRefreshToken(refreshToken)}`;
}

function resolveTtl(): number {
  const raw = process.env.MS365_MCP_SESSION_TTL_SECONDS;
  if (!raw) return DEFAULT_TTL_SECONDS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_SECONDS;
}

export async function storeGatewayRefreshToken(args: {
  redis: RedisClient;
  tenantId: string;
  refreshToken: string;
  accessToken: string;
}): Promise<void> {
  await args.redis.set(
    refreshKey(args.tenantId, args.refreshToken),
    JSON.stringify({ accessTokenHash: hashAccessToken(args.accessToken), accessToken: args.accessToken }),
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
  const raw = await args.redis.get(refreshKey(args.tenantId, args.refreshToken));
  if (!raw) return null;
  const parsed = JSON.parse(raw) as { accessToken?: string };
  if (!parsed.accessToken) return null;
  const record = await args.sessionStore.get(args.tenantId, parsed.accessToken);
  return record ? { accessToken: parsed.accessToken, record } : null;
}

export async function rotateGatewayRefreshToken(args: {
  redis: RedisClient;
  tenantId: string;
  oldRefreshToken: string;
  newRefreshToken: string;
  accessToken: string;
}): Promise<boolean> {
  const oldKey = refreshKey(args.tenantId, args.oldRefreshToken);
  const consumed = await args.redis.getdel(oldKey);
  if (!consumed) return false;
  await storeGatewayRefreshToken({
    redis: args.redis,
    tenantId: args.tenantId,
    refreshToken: args.newRefreshToken,
    accessToken: args.accessToken,
  });
  return true;
}

export async function revokeGatewayRefreshToken(args: {
  redis: RedisClient;
  tenantId: string;
  refreshToken: string;
}): Promise<void> {
  await args.redis.del(refreshKey(args.tenantId, args.refreshToken));
}
