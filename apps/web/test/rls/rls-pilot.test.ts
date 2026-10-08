import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { as, startPostgres } from "./pg-harness.ts";
import type { Harness } from "./pg-harness.ts";

/** Migration 0004 (pilot) on local PostgreSQL with Supabase auth emulation. */
const A = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa"; // invited
const B = "bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb"; // not invited
const EA = { email: "a@example.com" };
const EB = { email: "b@example.com" };
let h: Harness;
const denied = (re = /row-level security|permission denied|append-only|operator-managed|violates/) => (e: unknown) => re.test((e as Error).message);
const activate = (u: string, claims: Record<string, unknown>, cohort = "pilot-1", status = "ACTIVE") =>
  as(h.pool, "authenticated", u, "insert into public.klynge_pilot_enrollment (status, cohort, activated_at, risk_ack_version, consent_version, status_changed_at) values ($1, $2, 1, 'risk-v1', 'consent-v1', 1)", [status, cohort], claims);
const feedback = (_id: string) => JSON.stringify({ kind: "USER_REPORTED", ratings: { clarity: 4 } });

before(async () => {
  h = await startPostgres({ migrations: "all" });
  await h.pool.query("insert into auth.users (id, email, email_confirmed_at) values ($1, 'a@example.com', now()), ($2, 'b@example.com', now())", [A, B]);
  await h.pool.query("insert into public.klynge_pilot_invites (email_lower, cohort, invited_at) values ('a@example.com', 'pilot-1', 1)");
});
after(async () => h?.stop());

describe("RLS certification — pilot (migration 0004)", () => {
  it("RLS enabled on every pilot table; API roles have no access to triage or operator audit", async () => {
    const r = await h.pool.query("select relname, relrowsecurity from pg_class where relname in ('klynge_pilot_invites','klynge_pilot_enrollment','klynge_onboarding','klynge_feedback','klynge_feedback_triage','klynge_ops_audit')");
    assert.equal(r.rows.length, 6);
    assert.ok(r.rows.every((x) => x.relrowsecurity));
    for (const t of ["klynge_feedback_triage", "klynge_ops_audit"]) {
      await assert.rejects(as(h.pool, "authenticated", A, `select * from public.${t}`, [], EA), denied(/permission denied/));
      await assert.rejects(as(h.pool, "anon", null, `select * from public.${t}`), denied(/permission denied/));
    }
  });
  it("invites are visible only to their own address; users cannot invite themselves", async () => {
    assert.equal((await as(h.pool, "authenticated", A, "select * from public.klynge_pilot_invites", [], EA)).length, 1);
    assert.equal((await as(h.pool, "authenticated", B, "select * from public.klynge_pilot_invites", [], EB)).length, 0);
    await assert.rejects(as(h.pool, "authenticated", B, "insert into public.klynge_pilot_invites (email_lower, invited_at) values ('b@example.com', 1)", [], EB), denied(/permission denied/));
    await assert.rejects(as(h.pool, "anon", null, "select * from public.klynge_pilot_invites"), denied(/permission denied/));
  });
  it("activation requires a pending invite for the caller's own email, ACTIVE status and the caller's own tenant", async () => {
    await assert.rejects(activate(B, EB), denied(/row-level security/), "not invited");
    await assert.rejects(activate(A, EA, "pilot-1", "SUSPENDED"), denied(/row-level security/), "users cannot pick a status");
    await assert.rejects(activate(A, EA, "other-cohort"), denied(/row-level security/), "cohort must match the invite");
    await activate(A, EA);
    assert.equal((await as(h.pool, "authenticated", A, "select status from public.klynge_pilot_enrollment", [], EA))[0]!.status, "ACTIVE");
    assert.equal((await as(h.pool, "authenticated", B, "select * from public.klynge_pilot_enrollment", [], EB)).length, 0, "cross-user invisible");
  });
  it("users cannot suspend, reinstate or complete; operators can, but never rewrite identity or consent", async () => {
    await assert.rejects(as(h.pool, "authenticated", A, "update public.klynge_pilot_enrollment set status = 'COMPLETED'", [], EA), denied(/permission denied/));
    await as(h.pool, "service_role", null, "update public.klynge_pilot_enrollment set status = 'SUSPENDED', status_changed_at = 2, status_reason = 'operator review' where tenant_id = $1", [A]);
    assert.equal((await h.pool.query("select status from public.klynge_pilot_enrollment where tenant_id = $1", [A])).rows[0].status, "SUSPENDED");
    await assert.rejects(as(h.pool, "service_role", null, "update public.klynge_pilot_enrollment set consent_version = 'forged' where tenant_id = $1", [A]), denied(/immutable/));
    await assert.rejects(as(h.pool, "authenticated", A, "delete from public.klynge_pilot_enrollment", [], EA), denied(/permission denied/));
  });
  it("feedback: own insert/read, append-only, cannot reference another tenant, never touches decisions", async () => {
    await as(h.pool, "authenticated", A, "insert into public.klynge_feedback (feedback_id, session_id, at, payload) values ('fb-000001', 's1', 1, $1)", [feedback("1")], EA);
    await assert.rejects(as(h.pool, "authenticated", A, "update public.klynge_feedback set at = 2", [], EA), denied(/permission denied|append-only/));
    await assert.rejects(as(h.pool, "authenticated", B, "insert into public.klynge_feedback (tenant_id, feedback_id, at, payload) values ($1, 'fb-000002', 1, $2)", [A, feedback("2")], EB), denied(/row-level security/));
    await assert.rejects(as(h.pool, "authenticated", A, "insert into public.klynge_feedback (feedback_id, at, payload) values ('fb-000003', 1, $1)", [JSON.stringify({ kind: "VERIFIED_DEFECT" })], EA), denied(/violates check/), "users can only file USER_REPORTED feedback");
    assert.equal((await as(h.pool, "authenticated", B, "select * from public.klynge_feedback", [], EB)).length, 0);
    const grants = await h.pool.query("select has_table_privilege('authenticated', 'public.klynge_decisions', 'UPDATE') as u");
    assert.equal(grants.rows[0].u, false);
  });
  it("triage + operator audit are service-role only, with hashed operator refs", async () => {
    await as(h.pool, "service_role", null, "insert into public.klynge_feedback_triage (tenant_id, feedback_id, status, reviewer, at) values ($1, 'fb-000001', 'DEFECT_CONFIRMED', 'op_0123456789ab', 3)", [A]);
    await assert.rejects(as(h.pool, "service_role", null, "insert into public.klynge_ops_audit (audit_id, at, operator, action, detail) values ('a-00000001', 1, 'ops@example.com', 'pilot.invited', 'x')"), denied(/violates check/), "emails are not operator refs");
    await as(h.pool, "service_role", null, "insert into public.klynge_ops_audit (audit_id, at, operator, action, detail) values ('a-00000002', 1, 'op_0123456789ab', 'pilot.suspended', '1 enrollment')");
    await assert.rejects(as(h.pool, "service_role", null, "update public.klynge_ops_audit set detail = 'edited'"), denied(/append-only/));
  });
  it("onboarding progress: own only", async () => {
    await as(h.pool, "authenticated", A, "insert into public.klynge_onboarding (payload) values ($1)", [JSON.stringify({ version: 1, evidenceModesAcknowledgedAt: 1 })], EA);
    assert.equal((await as(h.pool, "authenticated", B, "select * from public.klynge_onboarding", [], EB)).length, 0);
    await assert.rejects(as(h.pool, "authenticated", B, "insert into public.klynge_onboarding (tenant_id, payload) values ($1, $2)", [A, JSON.stringify({ version: 1 })], EB), denied(/row-level security|duplicate/));
  });
});
