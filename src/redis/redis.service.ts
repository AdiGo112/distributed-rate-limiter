import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

declare module 'ioredis' {
  interface RedisCommander<Context> {
    tokenBucket(
      key: string,
      capacity: number,
      rate: number,
      cost: number,
    ): Promise<[allowed: number, tokens: string, retryAfterMs: number]>;
  }
}

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor() {
    this.client = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false, // fail fast if Redis is down
      commandTimeout: 100, // ms; the limiter must never be the slow part
    });
    // defineCommand uses EVALSHA with an EVAL fallback, so the script is sent once
    this.client.defineCommand('tokenBucket', {
      numberOfKeys: 1,
      lua: readFileSync(
        join(import.meta.dirname, '../limiter/lua/token-bucket.lua'),
        'utf8',
      ),
    });
  }

  onModuleDestroy() {
    this.client.disconnect();
  }
}
