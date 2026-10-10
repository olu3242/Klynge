import type { WorkflowInstance } from "./types.ts";
import type { WorkflowStore } from "./orchestrator.ts";

/** PostgreSQL CAS store. Inject a server-owned DB executor, never a user/client connection.
 * Uses positional parameters and tenant-scoped predicates. SQL migration is staged separately.
 */
export interface SqlExecutor {
  query<T extends Record<string, unknown>>(sql: string, params: readonly unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
}
type DbRow = Record<string, unknown>;
function decode(row: DbRow): WorkflowInstance {
  return {
    tenantId: String(row.tenant_id), workflowId: String(row.workflow_id),
    definitionId: String(row.definition_id), definitionVersion: Number(row.definition_version),
    status: row.status as WorkflowInstance["status"], revision: Number(row.revision),
    attempt: Number(row.attempt), maxAttempts: Number(row.max_attempts),
    createdAtMs: Number(row.created_at_ms), updatedAtMs: Number(row.updated_at_ms),
    processedEventIds: row.processed_event_ids as string[],
    audit: row.audit as WorkflowInstance["audit"],
  };
}
export class PostgresWorkflowStore implements WorkflowStore {
  constructor(private readonly db: SqlExecutor) {}
  async get(tenantId: string, workflowId: string) {
    const result = await this.db.query<DbRow>(
      "select * from public.klynge_workflow_instances where tenant_id = $1 and workflow_id = $2",
      [tenantId, workflowId],
    );
    return result.rows[0] ? decode(result.rows[0]) : null;
  }
  async insert(instance: WorkflowInstance) {
    const r = await this.db.query<DbRow>(
      `insert into public.klynge_workflow_instances
       (tenant_id, workflow_id, definition_id, definition_version, status, revision,
        attempt, max_attempts, created_at_ms, updated_at_ms, processed_event_ids, audit)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb)
       on conflict (tenant_id, workflow_id) do nothing returning workflow_id`,
      [instance.tenantId, instance.workflowId, instance.definitionId, instance.definitionVersion,
       instance.status, instance.revision, instance.attempt, instance.maxAttempts,
       instance.createdAtMs, instance.updatedAtMs,
       JSON.stringify(instance.processedEventIds), JSON.stringify(instance.audit)],
    );
    return r.rows.length === 1;
  }
  async compareAndSwap(expectedRevision: number, instance: WorkflowInstance) {
    if (instance.revision !== expectedRevision + 1) return false;
    const r = await this.db.query<DbRow>(
      `update public.klynge_workflow_instances set
        status=$4, revision=$5, attempt=$6, updated_at_ms=$7,
        processed_event_ids=$8::jsonb, audit=$9::jsonb
       where tenant_id=$1 and workflow_id=$2 and revision=$3
       returning workflow_id`,
      [instance.tenantId, instance.workflowId, expectedRevision, instance.status,
       instance.revision, instance.attempt, instance.updatedAtMs,
       JSON.stringify(instance.processedEventIds), JSON.stringify(instance.audit)],
    );
    return r.rows.length === 1;
  }
}
