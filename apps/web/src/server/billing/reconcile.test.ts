import { strict as assert } from "node:assert";
import { test } from "node:test";
import { reconcileSubscription } from "./reconcile.ts";
import type { SubscriptionEvent } from "./stripe-events.ts";

const event: SubscriptionEvent = {
  eventId: "evt_1", subscriptionId: "sub_1", customerId: "cus_1",
  state: "ACTIVE", periodEndMs: 2000000000000, createdMs: 1800000000000,
  cancelAtPeriodEnd: false,
};
test("creates an entitlement only with server-resolved user mapping", () => {
  assert.deepEqual(reconcileSubscription(null, event, "").action, "REJECT");
  const r = reconcileSubscription(null, event, "user_1");
  assert.equal(r.action, "APPLY");
  if (r.action === "APPLY") assert.equal(r.snapshot.entitlement.userId, "user_1");
});
test("rejects duplicate, stale, foreign-customer and foreign-user events", () => {
  const initial = reconcileSubscription(null, event, "user_1");
  assert.equal(initial.action, "APPLY");
  if (initial.action !== "APPLY") return;
  assert.deepEqual(reconcileSubscription(initial.snapshot, event, "user_1"), { action: "IGNORE", reason: "DUPLICATE" });
  assert.deepEqual(reconcileSubscription(initial.snapshot, { ...event, eventId: "evt_2", createdMs: event.createdMs - 1 }, "user_1"), { action: "IGNORE", reason: "STALE" });
  assert.equal(reconcileSubscription(initial.snapshot, { ...event, eventId: "evt_2", customerId: "cus_2" }, "user_1").action, "REJECT");
  assert.equal(reconcileSubscription(initial.snapshot, { ...event, eventId: "evt_2" }, "user_2").action, "REJECT");
  assert.equal(reconcileSubscription(initial.snapshot, { ...event, eventId: "evt_2", subscriptionId: "sub_2" }, "user_1").action, "REJECT");
});
test("later cancellations supersede active state", () => {
  const initial = reconcileSubscription(null, event, "user_1");
  assert.equal(initial.action, "APPLY");
  if (initial.action !== "APPLY") return;
  const r = reconcileSubscription(initial.snapshot, { ...event, eventId: "evt_3", createdMs: event.createdMs + 1000, state: "CANCELED" }, "user_1");
  assert.equal(r.action, "APPLY");
  if (r.action === "APPLY") assert.equal(r.snapshot.entitlement.state, "CANCELED");
});
