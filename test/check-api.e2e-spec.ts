import { once } from 'node:events';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { RedisService } from '../src/redis/redis.service.js';

// Needs a real Redis: docker run -d --rm -p 6379:6379 redis:7-alpine
describe('POST /v1/check', () => {
  let app: INestApplication;
  const key = (name: string) => `api-${name}-${Date.now()}`;
  const check = (body: object) =>
    request(app.getHttpServer()).post('/v1/check').send(body);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = mod.createNestApplication();
    await app.init();
    const { client } = app.get(RedisService);
    if (client.status !== 'ready') await once(client, 'ready');
  });
  afterAll(() => app.close());

  it('200 with remaining tokens', async () => {
    const res = await check({ key: key('ok'), plan: 'pro', cost: 5 }).expect(
      200,
    );
    expect(res.body).toEqual({ allowed: true, remaining: 95, retryAfterMs: 0 });
    expect(res.headers['x-ratelimit-remaining']).toBe('95');
  });

  it('429 with Retry-After once the burst is spent', async () => {
    const k = key('burst');
    for (let i = 0; i < 10; i++) await check({ key: k }).expect(200); // free: capacity 10
    const res = await check({ key: k }).expect(429);
    expect(res.body.allowed).toBe(false);
    expect(res.body.retryAfterMs).toBeGreaterThan(0);
    expect(res.headers['retry-after']).toBe('1'); // free refills 1/sec
  });

  it.each([
    ['missing key', {}],
    ['empty key', { key: '' }],
    ['key too long', { key: 'x'.repeat(129) }],
    ['unknown plan', { key: 'k', plan: 'gold' }],
    ['cost 0', { key: 'k', cost: 0 }],
    ['fractional cost', { key: 'k', cost: 1.5 }],
    ['cost as string', { key: 'k', cost: '1' }],
    ['cost above plan capacity', { key: 'k', plan: 'free', cost: 11 }],
  ])('400 on %s', async (_, body) => {
    await check(body).expect(400);
  });

  it('GET /metrics exposes the limiter metrics in Prometheus format', async () => {
    await check({ key: key('metrics') }).expect(200);
    const res = await request(app.getHttpServer()).get('/metrics').expect(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toMatch(
      /rl_decisions_total\{result="allowed",plan="free"\} \d+/,
    );
    expect(res.text).toContain('rl_check_duration_seconds_bucket');
    expect(res.text).toContain('rl_redis_errors_total');
  });
});

// Real connection failure (nothing listens on port 1), without stopping the
// shared Redis that the other e2e tests use.
describe('POST /v1/check with Redis down', () => {
  const startApp = async (failOpen: string) => {
    process.env.REDIS_URL = 'redis://127.0.0.1:1';
    process.env.FAIL_OPEN = failOpen;
    try {
      const mod = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      const app = mod.createNestApplication({ logger: false });
      await app.init();
      return app;
    } finally {
      delete process.env.REDIS_URL;
      delete process.env.FAIL_OPEN;
    }
  };

  it('fails open: 200, allowed, flagged degraded', async () => {
    const app = await startApp('true');
    try {
      const res = await request(app.getHttpServer())
        .post('/v1/check')
        .send({ key: 'down' })
        .expect(200);
      expect(res.body).toMatchObject({ allowed: true, degraded: true });
    } finally {
      await app.close();
    }
  });

  it('fails closed: 429, denied, flagged degraded, Retry-After 1', async () => {
    const app = await startApp('false');
    try {
      const res = await request(app.getHttpServer())
        .post('/v1/check')
        .send({ key: 'down' })
        .expect(429);
      expect(res.body).toMatchObject({ allowed: false, degraded: true });
      expect(res.headers['retry-after']).toBe('1');
    } finally {
      await app.close();
    }
  });
});
