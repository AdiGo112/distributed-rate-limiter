import { RedisService } from '../src/redis/redis.service.js';
import { once } from 'node:events';
import { TokenBucket } from '../src/limiter/core/token-bucket.js';
import { FakeClock } from '../src/limiter/core/clock.js';

// Needs a real Redis: docker run -d --rm -p 6379:6379 redis:7-alpine
describe('token-bucket.lua (real Redis)', () => {
  const redis = new RedisService();
  const key = (name: string) => `test:${name}:${Date.now()}`;

  // offline queue is off (fail fast), so wait for the connection before sending
  beforeAll(async () => {
    if (redis.client.status !== 'ready') await once(redis.client, 'ready');
  });
  afterAll(() => redis.onModuleDestroy());

  it('allows a burst up to capacity then denies with retryAfter', async () => {
    const k = key('burst');
    // rate is tiny so no refill sneaks in between calls
    for (let i = 0; i < 5; i++) {
      const [allowed] = await redis.client.tokenBucket(k, 5, 0.01, 1);
      expect(allowed).toBe(1);
    }
    const [allowed, tokens, retryAfterMs] = await redis.client.tokenBucket(
      k,
      5,
      0.01,
      1,
    );
    expect(allowed).toBe(0);
    expect(Number(tokens)).toBeLessThan(1);
    expect(retryAfterMs).toBeGreaterThan(90_000); // ~1 token / 0.01 per sec = 100 s
    expect(retryAfterMs).toBeLessThanOrEqual(100_000);
  });

  it('refills over time', async () => {
    const k = key('refill');
    await redis.client.tokenBucket(k, 1, 20, 1); // 20 tokens/sec -> 1 token per 50 ms
    expect((await redis.client.tokenBucket(k, 1, 20, 1))[0]).toBe(0);
    await new Promise((r) => setTimeout(r, 80));
    expect((await redis.client.tokenBucket(k, 1, 20, 1))[0]).toBe(1);
  });

  it('sets a TTL so idle buckets expire', async () => {
    const k = key('ttl');
    await redis.client.tokenBucket(k, 10, 1, 1);
    const ttl = await redis.client.pttl(k);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(20_000); // capacity/rate * 2
  });

  it('is atomic across app instances: 200 concurrent requests from 2 clients, capacity 100 -> exactly 100 allowed', async () => {
    // a second connection stands in for a second app instance
    const other = new RedisService();
    if (other.client.status !== 'ready') await once(other.client, 'ready');
    try {
      const k = key('race');
      const results = await Promise.all(
        Array.from({ length: 200 }, (_, i) =>
          (i % 2 ? other : redis).client.tokenBucket(k, 100, 0.001, 1),
        ),
      );
      expect(results.filter(([allowed]) => allowed === 1)).toHaveLength(100);
    } finally {
      other.onModuleDestroy();
    }
  });

  // Same random (gap, cost) sequence through both implementations, on the same
  // simulated clock: every decision must match the in-memory reference exactly.
  it.each([
    { capacity: 10, rate: 1 },
    { capacity: 100, rate: 20 },
    { capacity: 7, rate: 0.3 },
    { capacity: 3, rate: 13.7 },
  ])(
    'matches the in-memory reference (capacity $capacity, rate $rate)',
    async ({ capacity, rate }) => {
      const rand = mulberry32(capacity * 1000 + rate * 10); // seeded: failures are reproducible
      const clock = new FakeClock(1_000_000);
      const ref = new TokenBucket(capacity, rate, clock);
      const k = key(`parity-${capacity}-${rate}`);

      for (let step = 0; step < 1000; step++) {
        // mostly short gaps (bucket drains), sometimes long ones (refills to the cap)
        clock.advance(
          rand() < 0.9 ? Math.floor(rand() * 300) : Math.floor(rand() * 20_000),
        );
        const cost = 1 + Math.floor(rand() * Math.min(capacity, 5));

        const expected = ref.tryConsume(cost);
        const [allowed, tokens, retryAfterMs] = await redis.client.tokenBucket(
          k,
          capacity,
          rate,
          cost,
          clock.nowMs(),
        );
        const actual = {
          allowed: allowed === 1,
          remaining: Math.floor(Number(tokens)),
          retryAfterMs,
        };
        expect(actual, `step ${step}, cost ${cost}`).toEqual(expected);
      }
    },
  );
});

// tiny seeded PRNG so the parity sequence is the same on every run
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
