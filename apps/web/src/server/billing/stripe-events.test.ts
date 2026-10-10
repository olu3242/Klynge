import { strict as assert } from "node:assert";
import { test } from "node:test";
import { normalizeSubscriptionEvent } from "./stripe-events.ts";

const fixture = {
  id: "evt_123", type: "customer.subscription.updated", created: 1800000000,
  data: { object: {
    id: "sub_123", customer: "cus_123", status: "active",
    current_period_end: 1801000000, cancel_at_period_end: false,
  } },
};
test("normalizes subscription events without assigning a user", () => {
  assert.deepEqual(normalizeSubscriptionEvent(fixture), {
    eventId: "evt_123", subscriptionId: "sub_123", customerId: "cus_123",
    state: "ACTIVE", periodEndMs: 1801000000000, createdMs: 1800000000000,
    cancelAtPeriodEnd: false,
  });
});
test("rejects unrelated and malformed payloads", () => {
  assert.equal(normalizeSubscriptionEvent({ ...fixture, type: "checkout.session.completed" }), null);
  assert.equal(normalizeSubscriptionEvent({ ...fixture, data: { object: { ...fixture.data.object, status: "bogus" } } }), null);
  assert.equal(normalizeSubscriptionEvent({ ...fixture, data: { object: { ...fixture.data.object, current_period_end: "1801000000" } } }), null);
});
test("cancellation at period end retains ACTIVE state for policy evaluation", () => {
  const event = normalizeSubscriptionEvent({ ...fixture, data: { object: { ...fixture.data.object, cancel_at_period_end: true } } });
  assert.equal(event?.state, "ACTIVE");
  assert.equal(event?.cancelAtPeriodEnd, true);
});
