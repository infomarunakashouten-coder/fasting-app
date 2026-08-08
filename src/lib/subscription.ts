export const DOWNGRADE_STORAGE_KEY = "fastingCancelAtPeriodEnd";

type SubscriptionProfile = Record<string, unknown> | null | undefined;

export const hasPendingDowngrade = (
  profile: SubscriptionProfile,
  localValue = false
) =>
  Boolean(
    profile?.cancel_at_period_end ||
      profile?.subscription_cancel_at_period_end ||
      localValue
  );

export const getSubscriptionPeriodEnd = (profile: SubscriptionProfile) => {
  const value =
    profile?.subscription_current_period_end ??
    profile?.current_period_end ??
    profile?.next_billing_date;

  return typeof value === "string" && value ? value : null;
};

export const readPendingDowngrade = () =>
  typeof window !== "undefined" &&
  window.localStorage.getItem(DOWNGRADE_STORAGE_KEY) === "true";

export const savePendingDowngrade = (pending: boolean) => {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(DOWNGRADE_STORAGE_KEY, String(pending));
  }
};
