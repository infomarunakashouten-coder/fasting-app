export const BILLING_ENABLED =
  process.env.NEXT_PUBLIC_BILLING_ENABLED === "true";

export const PREMIUM_PRICE = 1980;
export const PREMIUM_PRICE_LABEL = `月額${PREMIUM_PRICE.toLocaleString("ja-JP")}円`;

export const premiumPriceDisplay = BILLING_ENABLED
  ? PREMIUM_PRICE_LABEL
  : `正式版予定：${PREMIUM_PRICE_LABEL}`;

export const hasPremiumAccess = (
  planType?: string | null,
  legacyPlan?: string | null
) =>
  !BILLING_ENABLED ||
  planType === "ai_fasting" ||
  planType === "honkaku" ||
  planType === "light" ||
  legacyPlan === "ai_fasting" ||
  legacyPlan === "honkaku" ||
  legacyPlan === "light";
