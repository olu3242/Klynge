/**
 * HOSTED RLS CERTIFICATION (manual; never in CI). Run only after the migration has been deliberately applied:
 *   SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY  →  npm run rls:hosted -- --confirm
 * Uses allow-listed service-role operations only to verify the schema and to create/delete two throwaway users.
 * Every authorization check runs through PostgREST with the users' own JWTs (RLS executes). Prints no secrets.
 * Exit code 1 ⇒ STATUS BLOCKED (never weaken RLS to pass).
 */
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { serviceRoleClient } from "../src/server/admin/service-role.ts";

if (!process.argv.includes("--confirm")) {
  console.error("Refusing to touch a hosted project without --confirm.");
  process.exit(2);
}
const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !anon || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Need SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in the environment.");
  process.exit(2);
}

const results: { name: string; ok: boolean; detail?: string }[] = [];
const check = (name: string, ok: boolean, detail?: string) => {
  results.push({ name, ok, ...(detail ? { detail } : {}) });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail && !ok ? ` — ${detail}` : ""}`);
};
const TABLES = ["klynge_sessions", "klynge_decisions", "klynge_alerts", "klynge_journal", "klynge_runtime_state", "klynge_user_policies", "klynge_policy_verdicts", "klynge_notification_prefs", "klynge_notification_outbox", "klynge_audit_log"];

const verify = serviceRoleClient("schema.verify");
for (const t of TABLES) {
  const { error } = await verify.from(t).select("*", { head: true, count: "exact" });
  check(`schema: ${t} exists`, !error, error?.message);
}

const admin = serviceRoleClient("certification.test-users");
const tag = randomUUID().slice(0, 8);
const users: { id: string; client: SupabaseClient }[] = [];
async function signedInClient(email: string) {
  const created = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (created.error || !created.data.user) throw new Error("could not create certification user");
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const hashed = link.data?.properties?.hashed_token;
  if (link.error || !hashed) throw new Error("could not generate a magic link");
  const client = createClient(url as string, anon as string, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.verifyOtp({ token_hash: hashed, type: "email" });
  if (error) throw new Error("magic-link verification failed");
  return { id: created.data.user.id, client };
}

try {
  users.push(await signedInClient(`klynge-rls-a-${tag}@example.com`), await signedInClient(`klynge-rls-b-${tag}@example.com`));
  const [a, b] = users as [(typeof users)[0], (typeof users)[0]];
  const anonClient = createClient(url, anon, { auth: { persistSession: false } });
  const session = (t: string, id: string) => ({ tenant_id: t, session_id: id, origin: "DIRECT", payload: { tenantId: t, sessionId: id, createdAt: 1, charts: [] } });
  const decision = (t: string, id: string, mode: "VISUAL" | "DATA", extra: Record<string, unknown> = {}) => ({
    tenant_id: t, record_id: id, session_id: "s", symbol: "TSLA", evidence_mode: mode, at: 1,
    payload: { recordId: id, tenantId: t, evidenceMode: mode, ...(mode === "DATA" ? { data: { evidenceMode: "DATA", decision: "WAIT" } } : { visual: { permission: "WAIT" } }), ...extra },
  });

  check("own session insert", !(await a.client.from("klynge_sessions").insert(session(a.id, "s1"))).error);
  check("own session read", ((await a.client.from("klynge_sessions").select("session_id")).data ?? []).length === 1);
  check("own session update", !(await a.client.from("klynge_sessions").update({ origin: "DIRECT" }).eq("session_id", "s1")).error);
  check("cross-user read denied", ((await b.client.from("klynge_sessions").select("*")).data ?? []).length === 0);
  check("cross-user insert denied", Boolean((await b.client.from("klynge_sessions").insert(session(a.id, "evil"))).error));
  const upd = await b.client.from("klynge_sessions").update({ origin: "ANONYMOUS_TRIAL" }).eq("tenant_id", a.id).select();
  check("cross-user update denied", (upd.data ?? []).length === 0);
  check("anonymous read denied", Boolean((await anonClient.from("klynge_sessions").select("*")).error));
  check("anonymous write denied", Boolean((await anonClient.from("klynge_sessions").insert(session(a.id, "anon"))).error));
  check("own decision insert", !(await a.client.from("klynge_decisions").insert(decision(a.id, "r1", "DATA"))).error);
  check("append-only: decision update denied", Boolean((await a.client.from("klynge_decisions").update({ at: 2 }).eq("record_id", "r1")).error));
  check("append-only: decision delete denied", Boolean((await a.client.from("klynge_decisions").delete().eq("record_id", "r1")).error));
  check("VISUAL cannot hold a directional decision", Boolean((await a.client.from("klynge_decisions").insert(decision(a.id, "v1", "VISUAL", { data: { evidenceMode: "DATA", decision: "CALL_SETUP" } }))).error));
  check("journal own insert", !(await a.client.from("klynge_journal").insert({ tenant_id: a.id, entry_id: "j1", record_id: "r1", symbol: "TSLA", note: "n", author: "a", created_at: 1 })).error);
  check("journal cross-user read denied", ((await b.client.from("klynge_journal").select("*")).data ?? []).length === 0);
  check("journal cannot reference another user's decision", Boolean((await b.client.from("klynge_journal").insert({ tenant_id: b.id, entry_id: "j2", record_id: "r1", symbol: "TSLA", note: "n", author: "b", created_at: 1 })).error));
  check("alert own insert", !(await a.client.from("klynge_alerts").insert({ tenant_id: a.id, alert_id: "al1", at: 1, payload: { alertId: "al1" } })).error);
  check("alert cross-user read denied", ((await b.client.from("klynge_alerts").select("*")).data ?? []).length === 0);
  check("alert update denied", Boolean((await a.client.from("klynge_alerts").update({ at: 2 }).eq("alert_id", "al1")).error));
  const prefs = (address: string | null) => ({ version: 1, email: { enabled: Boolean(address), address, events: "ALL", minSeverity: "ATTENTION" }, maxPerHour: 6 });
  check("notification prefs: own verified email allowed", !(await a.client.from("klynge_notification_prefs").insert({ tenant_id: a.id, payload: prefs(`klynge-rls-a-${tag}@example.com`) })).error);
  check("notification prefs: arbitrary address denied", Boolean((await b.client.from("klynge_notification_prefs").insert({ tenant_id: b.id, payload: prefs("victim@example.com") })).error));
  check("audit log: forged entry for another user denied", Boolean((await b.client.from("klynge_audit_log").insert({ tenant_id: a.id, audit_id: "x", at: 1, action: "auth.sign_in", detail: "forged" })).error));
  check("policy verdict cannot reference another user's decision", Boolean((await b.client.from("klynge_policy_verdicts").insert({ tenant_id: b.id, record_id: "r1", at: 1, payload: { recordId: "r1", tenantId: b.id } })).error));
} catch (e) {
  check("certification setup", false, (e as Error).message);
} finally {
  for (const u of users) await admin.auth.admin.deleteUser(u.id).catch(() => undefined);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\nhosted RLS certification: ${results.length - failed}/${results.length} — STATUS ${failed ? "BLOCKED" : "CERTIFIED"}`);
process.exit(failed ? 1 : 0);
