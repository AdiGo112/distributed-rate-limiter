import { BadRequestException } from '@nestjs/common';
import { LimiterService } from '../src/limiter/limiter.service.js';
import type { RedisService } from '../src/redis/redis.service.js';
import { decisions, redisErrors } from '../src/metrics/metrics.js';

// Stand-in for RedisService: only client.tokenBucket is used
const fakeRedis = (tokenBucket: (...args: unknown[]) => Promise<unknown>) =>
  ({ client: { tokenBucket } }) as unknown as RedisService;

describe('LimiterService', () => {
  afterEach(() => delete process.env.FAIL_OPEN);

  it('maps the Lua reply and namespaces the key by plan', async () => {
    const calls: unknown[][] = [];
    const svc = new LimiterService(
      fakeRedis(async (...args) => (calls.push(args), [1, '7.6', 0])),
    );
    expect(await svc.check({ key: 'u1', plan: 'pro', cost: 2 })).toEqual({
      allowed: true,
      remaining: 7,
      retryAfterMs: 0,
    });
    expect(calls[0]).toEqual(['rl:pro:u1', 100, 20, 2]);
  });

  it('defaults to the free plan and cost 1', async () => {
    const calls: unknown[][] = [];
    const svc = new LimiterService(
      fakeRedis(async (...args) => (calls.push(args), [0, '0', 1000])),
    );
    expect((await svc.check({ key: 'u1' })).allowed).toBe(false);
    expect(calls[0]).toEqual(['rl:free:u1', 10, 1, 1]);
  });

  it('fails open by default when Redis errors', async () => {
    const svc = new LimiterService(
      fakeRedis(() => Promise.reject(new Error('down'))),
    );
    expect(await svc.check({ key: 'u1' })).toMatchObject({
      allowed: true,
      degraded: true,
    });
  });

  it('fails closed when FAIL_OPEN=false', async () => {
    process.env.FAIL_OPEN = 'false';
    const svc = new LimiterService(
      fakeRedis(() => Promise.reject(new Error('down'))),
    );
    expect(await svc.check({ key: 'u1' })).toMatchObject({
      allowed: false,
      degraded: true,
    });
  });

  it('rejects a cost above plan capacity', async () => {
    const svc = new LimiterService(fakeRedis(async () => [1, '0', 0]));
    await expect(
      svc.check({ key: 'u1', plan: 'free', cost: 11 }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('LimiterService metrics', () => {
  const count = async ({ result, plan }: { result: string; plan: string }) =>
    (await decisions.get()).values.find(
      (v) => v.labels.result === result && v.labels.plan === plan,
    )?.value ?? 0;

  beforeEach(() => {
    decisions.reset();
    redisErrors.reset();
  });

  it('counts allowed, denied and degraded decisions by plan', async () => {
    const replies = [
      [1, '1', 0],
      [0, '0', 500],
    ];
    const ok = new LimiterService(fakeRedis(async () => replies.shift()));
    await ok.check({ key: 'm', plan: 'pro' });
    await ok.check({ key: 'm', plan: 'pro' });
    await new LimiterService(
      fakeRedis(() => Promise.reject(new Error('down'))),
    ).check({ key: 'm' });

    expect(await count({ result: 'allowed', plan: 'pro' })).toBe(1);
    expect(await count({ result: 'denied', plan: 'pro' })).toBe(1);
    expect(await count({ result: 'degraded', plan: 'free' })).toBe(1);
    expect((await redisErrors.get()).values[0].value).toBe(1);
  });
});
