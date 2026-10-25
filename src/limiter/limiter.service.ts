import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service.js';
import { PLANS } from '../config/plans.js';
import { checkDuration, decisions, redisErrors } from '../metrics/metrics.js';
import type { CheckDto } from './dto/check.dto.js';

export interface CheckResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
  degraded?: boolean; // true = Redis failed, answer came from the FAIL_OPEN switch
}

@Injectable()
export class LimiterService {
  private readonly log = new Logger(LimiterService.name);
  private readonly failOpen = (process.env.FAIL_OPEN ?? 'true') === 'true';

  constructor(private readonly redis: RedisService) {}

  async check(dto: CheckDto): Promise<CheckResult> {
    const planName = dto.plan ?? 'free';
    const plan = PLANS[planName];
    const cost = dto.cost ?? 1;
    // a bucket never holds more than capacity, so this would be denied forever
    if (cost > plan.capacity) {
      throw new BadRequestException(
        `cost ${cost} exceeds ${planName} capacity ${plan.capacity}`,
      );
    }

    const endTimer = checkDuration.startTimer();
    try {
      const [allowed, tokens, retryAfterMs] =
        await this.redis.client.tokenBucket(
          `rl:${planName}:${dto.key}`,
          plan.capacity,
          plan.refillPerSec,
          cost,
        );
      const result = {
        allowed: allowed === 1,
        remaining: Math.floor(Number(tokens)),
        retryAfterMs,
      };
      decisions.inc({
        result: result.allowed ? 'allowed' : 'denied',
        plan: planName,
      });
      // debug only (LOG_LEVEL=debug): one line per request is too much at load-test volume
      this.log.debug({ key: dto.key, plan: planName, cost, ...result });
      return result;
    } catch (e) {
      redisErrors.inc();
      decisions.inc({ result: 'degraded', plan: planName });
      this.log.error(
        `Redis error, failing ${this.failOpen ? 'open' : 'closed'}: ${(e as Error).message}`,
      );
      return {
        allowed: this.failOpen,
        remaining: 0,
        retryAfterMs: 0,
        degraded: true,
      };
    } finally {
      endTimer();
    }
  }
}
