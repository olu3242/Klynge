import { strict as assert } from "node:assert";
import { test } from "node:test";
import { SupabaseReviewerAuthenticator } from "./supabase-reviewer.ts";
import type { AuthGateway, VerifiedUser } from "../auth/types.ts";
function gateway(kind: AuthGateway["kind"], user: VerifiedUser | null): AuthGateway {
  return { kind, getUser: async () => user,
    startOAuth: async () => { throw new Error("unused"); },
    sendMagicLink: async () => {}, exchangeCode: async () => { throw new Error("unused"); },
    verifyMagicLink: async () => { throw new Error("unused"); }, signOut: async () => {} };
}
test("only verified Supabase app role grants approval", async () => {
  const user: VerifiedUser = { id: "t1", email: null, method: "email", appRole: "workflow_approver" };
  assert.deepEqual((await new SupabaseReviewerAuthenticator(gateway("supabase", user)).authenticate())?.roles, ["workflow.approve"]);
  assert.deepEqual((await new SupabaseReviewerAuthenticator(gateway("supabase", { ...user, appRole: undefined })).authenticate())?.roles, []);
  assert.equal(await new SupabaseReviewerAuthenticator(gateway("mock", user)).authenticate(), null);
  assert.equal(await new SupabaseReviewerAuthenticator(gateway("supabase", null)).authenticate(), null);
});
