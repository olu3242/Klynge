/** Server-side subscription access policy. Never derive entitlements from client input.
 * This is a pure policy module; wiring to a verified billing webhook/store is required
 * before enforcing paid access. Pilot access remains governed separately.
 */
export type SubscriptionState = "ACTIVE" | "TRIALING" | "PAST_DUE" | "CANCELED" | "UNPAID" | "INCOMPLETE";
export type SubscriptionEntitlement = Readonly<{
  userId: string;
  state: SubscriptionState;
  currentPeriodEndMs: number;
  cancelAtPeriodEnd: boolean;
}>;
export type SubscriptionDecision = "ALLOW" | "DENY" | "REVERIFY";

export function subscriptionVerdict(
  authenticatedUserId: string | null,
  entitlement: SubscriptionEntitlement | null,
  nowMs: number,
): SubscriptionDecision {
  if (!authenticatedUserId || !entitlement) return "DENY";
  if (entitlement.userId !== authenticatedUserId) return "DENY";
  if (!Number.isFinite(nowMs) || !Number.isFinite(entitlement.currentPeriodEndMs)) return "REVERIFY";
  if (entitlement.currentPeriodEndMs <= nowMs) return "DENY";
  if (entitlement.state === "ACTIVE" || entitlement.state === "TRIALING") return "ALLOW";
  if (entitlement.state === "PAST_DUE" || entitlement.state === "INCOMPLETE") return "REVERIFY";
  return "DENY";
}
