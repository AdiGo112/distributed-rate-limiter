export const PLANS = {
  free: { capacity: 10, refillPerSec: 1 },
  pro: { capacity: 100, refillPerSec: 20 },
} as const;

export type PlanName = keyof typeof PLANS;
export const PLAN_NAMES = Object.keys(PLANS) as PlanName[];
