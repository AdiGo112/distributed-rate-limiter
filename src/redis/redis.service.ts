import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
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
      nowMs?: number, // tests only; production uses Redis TIME
    ): Promise<[allowed: number, tokens: string, retryAfterMs: number]>;
  }
}

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;
  private readonly log = new Logger(RedisService.name);

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

    // log state changes only: 'error'/'close' repeat on every reconnect attempt.
    // 'close' covers a clean Redis shutdown, which emits no 'error'.
    let up: boolean | undefined;
    const down = (reason: string) => {
      if (up !== false) this.log.error(`Redis unavailable: ${reason}`);
      up = false;
    };
    this.client.on('ready', () => {
      up = true;
      this.log.log('Redis connected');
    });
    this.client.on('error', (e: Error) => down(e.message));
    this.client.on('close', () => down('connection closed'));
  }

  onModuleDestroy() {
    this.client.removeAllListeners('close'); // our own shutdown is not an outage
    this.client.disconnect();
  }
}
