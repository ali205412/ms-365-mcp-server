-- src/lib/rate-limit/sliding-window.lua
-- Plan 06-04 (D-03, OPS-08): atomic ZSET sliding-window rate limiter.
--
-- KEYS[1] = sorted-set key (e.g., mcp:rl:req:{tenantId} or mcp:rl:graph:{tenantId})
-- ARGV[1] = window_ms (integer, e.g., 60000)
-- ARGV[2] = max_count (integer)
-- ARGV[3] = now_ms (integer, caller-supplied — tests pin the clock)
-- ARGV[4] = unique request ID (string — prevents ZADD dedup on duplicate timestamp)
-- ARGV[5] = cost (integer, default 1 — for weighted observe; consume uses 1)
--
-- Returns {allowed: 0|1, current_count: int, retry_after_ms: int}
-- retry_after_ms == 0 when allowed; > 0 when denied.
--
-- Execution order (atomic under Lua):
--   1. ZREMRANGEBYSCORE evict entries older than (now_ms - window_ms)
--   2. ZCARD count remaining entries in the window
--   3. Gate: if current + cost > max_count → compute retry_after_ms from
--      the oldest entry (the next one to age out) and return denied.
--   4. ZADD admitting entry (N copies if cost > 1 — suffix with :i to avoid dedup)
--   5. PEXPIRE safety-net TTL = 2× window_ms so abandoned tenant keys age out
--
-- Pitfall 3 note: caller-supplied now_ms enables unit-test clock pinning.
-- Production callers pass Date.now(); replicas rely on NTP-sync drift being
-- sub-ms at 60s windows — documented in runbook.md (plan 06-07).

local key = KEYS[1]
local window_ms = tonumber(ARGV[1])
local max_count = tonumber(ARGV[2])
local now_ms   = tonumber(ARGV[3])
local req_id   = ARGV[4]
local cost     = tonumber(ARGV[5] or "1")

local cutoff = now_ms - window_ms

-- 1. Evict entries older than the window
redis.call('ZREMRANGEBYSCORE', key, '-inf', '(' .. cutoff)

-- 2. Count entries currently inside the window
local current = redis.call('ZCARD', key)

-- 3. Gate: would this request's cost exceed the budget?
if current + cost > max_count then
  -- Compute retry_after_ms from the oldest entry (next one to age out)
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retry_ms = 0
  if #oldest >= 2 then
    retry_ms = math.max(0, (tonumber(oldest[2]) + window_ms) - now_ms)
  end
  return {0, current, retry_ms}
end

-- 4. Admit: ZADD the request (or N copies for a weighted cost)
for i = 1, cost do
  -- Suffix req_id with i so N copies don't dedup on the same member
  redis.call('ZADD', key, now_ms, req_id .. ':' .. tostring(i))
end

-- 5. Safety-net TTL: 2× window so abandoned tenants don't leak keys
redis.call('PEXPIRE', key, window_ms * 2)

return {1, current + cost, 0}
