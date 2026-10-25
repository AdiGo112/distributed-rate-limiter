import {
  Counter,
  Histogram,
  collectDefaultMetrics,
  register,
} from 'prom-client';

collectDefaultMetrics(); // process CPU, memory, event loop lag

export const decisions = new Counter({
  name: 'rl_decisions_total',
  help: 'Rate limit decisions',
  labelNames: ['result', 'plan'] as const, // result: allowed | denied | degraded
});

export const checkDuration = new Histogram({
  name: 'rl_check_duration_seconds',
  help: 'Time to decide one check, including the Redis round trip',
  buckets: [0.001, 0.002, 0.005, 0.01, 0.025, 0.05, 0.1],
});

export const redisErrors = new Counter({
  name: 'rl_redis_errors_total',
  help: 'Redis calls that failed and fell back to FAIL_OPEN',
});

export { register };
