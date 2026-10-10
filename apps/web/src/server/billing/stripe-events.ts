/** Strict, provider-agnostic normalization of Stripe subscription event payloads.
 * This module does not accept client-supplied entitlements and never grants access
 * without a separately verified webhook signature and durable user mapping.
 */
import type { SubscriptionState } from "./entitlement.ts";

export interface SubscriptionEvent {
  eventId: string;
  subscriptionId: string;
  customerId: string;
  state: SubscriptionState;
  periodEndMs: number;
  cancelAtPeriodEnd: boolean;
  createdMs: number;
}

const STATES: Record<string, SubscriptionState> = {
  active: "ACTIVE", trialing: "TRIALING", past_due: "PAST_DUE",
  canceled: "CANCELED", unpaid: "UNPAID", incomplete: "INCOMPLETE",
  incomplete_expired: "INCOMPLETE", paused: "UNPAID",
};

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function id(value: unknown): string | null {
  return typeof value === "string" && /^[a-zA-Z0-9_]{3,255}$/.test(value) ? value : null;
}
export function normalizeSubscriptionEvent(payload: unknown): SubscriptionEvent | null {
  const event = object(payload);
  const data = object(event?.data);
  const subscription = object(data?.object);
  if (!event || !subscription || typeof event.type !== "string" ||
      !event.type.startsWith("customer.subscription.")) return null;
  const eventId = id(event.id);
  const subscriptionId = id(subscription.id);
  const customerId = id(subscription.customer);
  const state = typeof subscription.status === "string" ? STATES[subscription.status] : undefined;
  const end = subscription.current_period_end;
  const created = event.created;
  if (!eventId || !subscriptionId || !customerId || !state ||
      typeof end !== "number" || !Number.isSafeInteger(end) || end <= 0 ||
      typeof created !== "number" || !Number.isSafeInteger(created) || created <= 0 ||
      typeof subscription.cancel_at_period_end !== "boolean") return null;
  return {
    eventId, subscriptionId, customerId, state,
    periodEndMs: end * 1000, createdMs: created * 1000,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
  };
}
