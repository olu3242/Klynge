import { strict as assert } from "node:assert";
import { test } from "node:test";
import { PostgresWorkflowGovernanceStore } from "./governance-store.ts";
import type { SqlExecutor } from "./postgres-store.ts";
test("approval lookup uses tenant and approval identifier parameters", async () => {
  const seen: { sql: string; params: readonly unknown[] }[] = [];
  const db: SqlExecutor = { async query<T extends Record<string, unknown>>(sql, params) {
    seen.push({ sql, params }); return { rows: [] as T[], rowCount: 0 };
  } };
  const store = new PostgresWorkflowGovernanceStore(db);
  assert.equal(await store.load("t1", "a1"), null);
  assert.deepEqual(seen[0]?.params, ["t1", "a1"]);
  assert.ok(seen[0]?.sql.includes("tenant_id=$1"));
});
test("approval update requires pending state and revision CAS", async () => {
  let sql = "";
  const db: SqlExecutor = { async query<T extends Record<string, unknown>>(statement) {
    sql = statement; return { rows: [{ approval_id: "a1" } as unknown as T], rowCount: 1 };
  } };
  const store = new PostgresWorkflowGovernanceStore(db);
  const prior = { approvalId: "a1", tenantId: "t1", workflowId: "w1", action: "rule.promote",
    requestedBy: "author", status: "PENDING" as const, reviewerId: null,
    decidedAtMs: null, expiresAtMs: 1000, revision: 0 };
  assert.equal(await store.decide(prior, { ...prior, status: "APPROVED", reviewerId: "reviewer", decidedAtMs: 100, revision: 1 }), true);
  assert.ok(sql.includes("revision=$4"));
  assert.ok(sql.includes("status='PENDING'"));
});
