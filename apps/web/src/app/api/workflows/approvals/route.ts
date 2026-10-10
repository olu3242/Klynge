import { NextResponse } from "next/server";
import { requestContext } from "@/server/http";
import { SupabaseReviewerAuthenticator } from "@/server/workflow-os/supabase-reviewer";
import { PostgresWorkflowGovernanceStore } from "@/server/workflow-os/governance-store";
import { handleAtomicApproval } from "@/server/workflow-os/atomic-approval-handler";
import type { QueueRpc } from "@/server/workflow-os/postgres-queue";
import type { SqlExecutor } from "@/server/workflow-os/postgres-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Explicitly disabled until hosted migration and authorization certification.
 * Database URL must point to a server-only restricted runtime role.
 */
export async function POST(req: Request) {
  if (process.env.KLYNGE_WORKFLOW_APPROVAL_API !== "enabled")
    return new NextResponse(null, { status: 404 });
  const ctx = await requestContext({ pilotGate: false }).catch(() => null);
  if (!ctx || ctx.gateway.kind !== "supabase" || ctx.identity.kind !== "USER")
    return new NextResponse(null, { status: 404 });
  const url = process.env.KLYNGE_WORKFLOW_DATABASE_URL;
  if (!url) return NextResponse.json({ error: "NOT_CONFIGURED" }, { status: 503 });
  const body: unknown = await req.json().catch(() => null);
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 3000 });
  try {
    const db: SqlExecutor = {
      async query<T extends Record<string, unknown>>(sql: string, params: readonly unknown[]) {
        const result = await pool.query(sql, [...params]);
        return { rows: result.rows as T[], rowCount: result.rowCount };
      },
    };
    const lookup = new PostgresWorkflowGovernanceStore(db);
    const rpc: QueueRpc = {
      async rpc(name, args) {
        if (name !== "klynge_decide_workflow_approval") throw new Error("RPC_DENIED");
        const result = await pool.query(
          "select public.klynge_decide_workflow_approval($1::uuid,$2::text,$3::text,$4::integer,$5::integer,$6::boolean,$7::bigint,$8::text) as applied",
          [args.p_tenant, args.p_approval, args.p_reviewer, args.p_expected_revision,
           args.p_workflow_revision, args.p_approve, args.p_now, args.p_event],
        );
        return { data: result.rows[0]?.applied ?? false, error: null };
      },
    };
    const outcome = await handleAtomicApproval(
      new SupabaseReviewerAuthenticator(ctx.gateway),
      {
        load: (tenantId, approvalId) => lookup.load(tenantId, approvalId),
        async workflowRevision(tenantId, workflowId) {
          const result = await db.query<{ revision: number }>(
            "select revision from public.klynge_workflow_instances where tenant_id=$1 and workflow_id=$2 and status='WAITING_HUMAN'",
            [tenantId, workflowId],
          );
          return result.rows[0]?.revision ?? null;
        },
      }, rpc, body, Date.now(),
    );
    return NextResponse.json(outcome.body, {
      status: outcome.status, headers: { "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "UNAVAILABLE" }, { status: 503 });
  } finally {
    await pool.end();
  }
}
