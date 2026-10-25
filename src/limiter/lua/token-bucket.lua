-- KEYS[1] = bucket key
-- ARGV[1] = capacity, ARGV[2] = refill tokens/sec, ARGV[3] = cost
-- ARGV[4] = now in ms (optional, tests only: lets them drive a simulated clock)
-- Returns { allowed (0|1), tokens left (string, keeps fractions), retry_after_ms }
local capacity = tonumber(ARGV[1])
local rate     = tonumber(ARGV[2])
local cost     = tonumber(ARGV[3])

-- Redis clock, not the app's, so skew between app instances doesn't matter
local now_ms = tonumber(ARGV[4])
if now_ms == nil then
  local t = redis.call('TIME')
  now_ms = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
end

local data = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])

if tokens == nil then
  tokens = capacity
  ts = now_ms
end

local elapsed = math.max(0, now_ms - ts)
tokens = math.min(capacity, tokens + (elapsed * rate) / 1000)

local allowed = 0
local retry_ms = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
else
  retry_ms = math.ceil(((cost - tokens) * 1000) / rate)
end

-- %.17g round-trips a double exactly; tostring keeps 14 digits, so 86.99999999999999
-- would be stored as 87 and the next call would get a token it never earned
local tokens_str = string.format('%.17g', tokens)
redis.call('HSET', KEYS[1], 'tokens', tokens_str, 'ts', now_ms)
-- idle buckets expire: time to fully refill, doubled, so memory stays bounded
redis.call('PEXPIRE', KEYS[1], math.ceil((capacity / rate) * 1000) * 2)

return { allowed, tokens_str, retry_ms }
