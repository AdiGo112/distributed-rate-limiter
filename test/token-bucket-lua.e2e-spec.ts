import { RedisService } from '../src/redis/redis.service.js';
import { once } from 'node:events';

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

  it('is atomic: 200 concurrent requests, capacity 100 -> exactly 100 allowed', async () => {
    const k = key('race');
    const results = await Promise.all(
      Array.from({ length: 200 }, () =>
        redis.client.tokenBucket(k, 100, 0.001, 1),
      ),
    );
    expect(results.filter(([allowed]) => allowed === 1)).toHaveLength(100);
  });
});
