import { NextResponse } from "next/server";
import { requestContext } from "@/server/http";
import { SupabaseReviewerAuthenticator } from "@/server/workflow-os/supabase-reviewer";
import { PostgresWorkflowGovernanceStore } from "@/server/workflow-os/governance-store";
import { handleApprovalRequest } from "@/server/workflow-os/approval-handler";
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
    const outcome = await handleApprovalRequest(
      new SupabaseReviewerAuthenticator(ctx.gateway),
      new PostgresWorkflowGovernanceStore(db), body, Date.now(),
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
