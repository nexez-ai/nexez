const PLAN_COMMISSION_PERCENT: Record<string, number> = {
  free: 9,
  launch: 7,
  pro: 5,
  scale: 3,
  enterprise: 2,
}

export function commissionPercentForPlan(planId?: string | null) {
  return planId ? PLAN_COMMISSION_PERCENT[planId] ?? PLAN_COMMISSION_PERCENT.free : PLAN_COMMISSION_PERCENT.free
}
