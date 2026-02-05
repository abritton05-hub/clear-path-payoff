export type PlanKey = "monthly" | "yearly" | "lifetime";

export const PLAN_CONFIG: Record<PlanKey, { priceId: string; mode: "subscription" | "payment" }> = {
  monthly: {
    priceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_MONTHLY ?? "",
    mode: "subscription",
  },
  yearly: {
    priceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_YEARLY ?? "",
    mode: "subscription",
  },
  lifetime: {
    priceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_LIFETIME ?? "",
    mode: "payment",
  },
};

export function getPlanByPriceId(priceId: string): PlanKey | null {
  if (priceId === PLAN_CONFIG.monthly.priceId) return "monthly";
  if (priceId === PLAN_CONFIG.yearly.priceId) return "yearly";
  if (priceId === PLAN_CONFIG.lifetime.priceId) return "lifetime";
  return null;
}
