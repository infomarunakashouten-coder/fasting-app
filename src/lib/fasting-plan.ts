const HIDDEN_PLAN_STATUSES = new Set([
  "canceled",
  "cancelled",
  "deleted",
  "inactive",
]);

type FastingPlanLike = {
  status?: unknown;
  created_at?: string | null;
  updated_at?: string | null;
};

const planTime = (plan: FastingPlanLike) => {
  const value = plan.created_at ?? plan.updated_at;
  if (!value) return 0;

  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
};

export function getLatestVisibleFastingPlan<T extends FastingPlanLike>(
  plans: T[] | null | undefined
) {
  return (
    [...(plans ?? [])]
      .filter(
        (plan) =>
          !HIDDEN_PLAN_STATUSES.has(String(plan.status ?? "").toLowerCase())
      )
      .sort((a, b) => planTime(b) - planTime(a))[0] ?? null
  );
}
