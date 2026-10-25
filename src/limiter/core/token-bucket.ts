import type { Clock } from './clock.js';

export interface Decision {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

// Reference implementation: the Redis Lua script must give the same answers.
export class TokenBucket {
  private tokens: number;
  private lastMs: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
    private readonly clock: Clock,
  ) {
    this.tokens = capacity;
    this.lastMs = clock.nowMs();
  }

  tryConsume(cost = 1): Decision {
    const now = this.clock.nowMs();
    const elapsed = Math.max(0, now - this.lastMs); // clock went backwards -> no refill
    this.tokens = Math.min(
      this.capacity,
      this.tokens + (elapsed * this.refillPerSec) / 1000,
    );
    this.lastMs = now;

    if (this.tokens >= cost) {
      this.tokens -= cost;
      return {
        allowed: true,
        remaining: Math.floor(this.tokens),
        retryAfterMs: 0,
      };
    }
    const retryAfterMs = Math.ceil(
      ((cost - this.tokens) * 1000) / this.refillPerSec,
    );
    return { allowed: false, remaining: Math.floor(this.tokens), retryAfterMs };
  }
}
