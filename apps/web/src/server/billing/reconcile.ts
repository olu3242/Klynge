import type { SubscriptionEvent } from "./stripe-events.ts";
import type { SubscriptionEntitlement } from "./entitlement.ts";

/** Durable adapters must transactionally dedupe event IDs before applying this pure reducer.
 * Never trust a client-provided user ID: customerId must be resolved from a server-owned mapping.
 */
export interface BillingSnapshot {
  subscriptionId: string;
  customerId: string;
  userId: string;
  lastEventCreatedMs: number;
  lastEventId: string;
  entitlement: SubscriptionEntitlement;
}
export type ReconcileResult =
  | { action: "APPLY"; snapshot: BillingSnapshot }
  | { action: "IGNORE"; reason: "STALE" | "DUPLICATE" }
  | { action: "REJECT"; reason: "CUSTOMER_MISMATCH" | "SUBSCRIPTION_MISMATCH" | "INVALID_USER" };

export function reconcileSubscription(
  prior: BillingSnapshot | null,
  event: SubscriptionEvent,
  mappedUserId: string,
): ReconcileResult {
  if (!mappedUserId.trim()) return { action: "REJECT", reason: "INVALID_USER" };
  if (prior && prior.userId !== mappedUserId) return { action: "REJECT", reason: "INVALID_USER" };
  if (prior && prior.customerId !== event.customerId) return { action: "REJECT", reason: "CUSTOMER_MISMATCH" };
  if (prior && prior.subscriptionId !== event.subscriptionId) return { action: "REJECT", reason: "SUBSCRIPTION_MISMATCH" };
  if (prior && prior.lastEventId === event.eventId) return { action: "IGNORE", reason: "DUPLICATE" };
  // Equal timestamps are ambiguous; fail closed and reconcile from Stripe's authoritative API.
  if (prior && event.createdMs <= prior.lastEventCreatedMs) return { action: "IGNORE", reason: "STALE" };
  return {
    action: "APPLY",
    snapshot: {
      subscriptionId: event.subscriptionId,
      customerId: event.customerId,
      userId: mappedUserId,
      lastEventCreatedMs: event.createdMs,
      lastEventId: event.eventId,
      entitlement: {
        userId: mappedUserId,
        state: event.state,
        currentPeriodEndMs: event.periodEndMs,
        cancelAtPeriodEnd: event.cancelAtPeriodEnd,
      },
    },
  };
}
