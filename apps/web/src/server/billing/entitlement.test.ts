import { strict as assert } from "node:assert";
import { test } from "node:test";
import { subscriptionVerdict } from "./entitlement.ts";

const active = { userId: "user-1", state: "ACTIVE" as const, currentPeriodEndMs: 2000, cancelAtPeriodEnd: false };
test("active verified entitlement permits its owner before period end", () => {
  assert.equal(subscriptionVerdict("user-1", active, 1000), "ALLOW");
});
test("anonymous, missing and cross-user entitlements fail closed", () => {
  assert.equal(subscriptionVerdict(null, active, 1000), "DENY");
  assert.equal(subscriptionVerdict("user-1", null, 1000), "DENY");
  assert.equal(subscriptionVerdict("user-2", active, 1000), "DENY");
});
test("expired and canceled access fail closed", () => {
  assert.equal(subscriptionVerdict("user-1", active, 2000), "DENY");
  assert.equal(subscriptionVerdict("user-1", { ...active, state: "CANCELED" }, 1000), "DENY");
  assert.equal(subscriptionVerdict("user-1", { ...active, state: "UNPAID" }, 1000), "DENY");
});
test("trialing access allowed only within period", () => {
  assert.equal(subscriptionVerdict("user-1", { ...active, state: "TRIALING" }, 1000), "ALLOW");
});
test("unsettled and invalid-clock cases require reverification", () => {
  assert.equal(subscriptionVerdict("user-1", { ...active, state: "PAST_DUE" }, 1000), "REVERIFY");
  assert.equal(subscriptionVerdict("user-1", { ...active, state: "INCOMPLETE" }, 1000), "REVERIFY");
  assert.equal(subscriptionVerdict("user-1", active, Number.NaN), "REVERIFY");
});
