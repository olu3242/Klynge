import { strict as assert } from "node:assert";
import { test } from "node:test";
import { PostgresWorkflowStore, type SqlExecutor } from "./postgres-store.ts";
import type { WorkflowInstance } from "./types.ts";
const sample: WorkflowInstance = {
  tenantId: "t1", workflowId: "w1", definitionId: "ticker", definitionVersion: 1,
  status: "CREATED", revision: 0, attempt: 0, maxAttempts: 2,
  createdAtMs: 1, updatedAtMs: 1, processedEventIds: [], audit: [],
};
test("store uses parameterized tenant-scoped insert and CAS", async () => {
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  const db: SqlExecutor = { async query<T extends Record<string, unknown>>(sql: string, params: readonly unknown[]) {
    calls.push({ sql, params });
    return { rows: [{ workflow_id: "w1" } as unknown as T], rowCount: 1 };
  } };
  const store = new PostgresWorkflowStore(db);
  assert.equal(await store.insert(sample), true);
  assert.equal(await store.compareAndSwap(0, { ...sample, revision: 1 }), true);
  assert.equal(await store.compareAndSwap(1, { ...sample, revision: 1 }), false);
  assert.ok(calls[0]?.sql.includes("on conflict"));
  assert.ok(calls[1]?.sql.includes("revision=$3"));
  assert.equal(calls[1]?.params[0], "t1");
  assert.equal(calls[1]?.params[1], "w1");
});
test("get scopes reads by tenant and workflow", async () => {
  let params: readonly unknown[] = [];
  const db: SqlExecutor = { async query<T extends Record<string, unknown>>(_sql: string, p: readonly unknown[]) {
    params = p; return { rows: [] as T[], rowCount: 0 };
  } };
  assert.equal(await new PostgresWorkflowStore(db).get("t1", "w1"), null);
  assert.deepEqual(params, ["t1", "w1"]);
});
