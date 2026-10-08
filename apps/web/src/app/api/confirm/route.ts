import { NextResponse } from "next/server";
import { errorResponse, identity } from "@/server/http";
import { clockFrom, runtimeDeps } from "@/server/runtime";
import { confirmField, WorkspaceError } from "@/server/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FIELDS = ["symbol", "timeframe", "lastPrice", "priceAxisRange", "vwapVisible", "priceVsVwap", "emaRelation", "structure", "volumeVisibility", "chartTime"];

export async function POST(req: Request) {
  try {
    const { tenantId, sessionId } = await identity();
    const body = (await req.json()) as { chartId?: string; field?: string; action?: string; value?: unknown };
    if (!body.chartId || !body.field || !FIELDS.includes(body.field) || (body.action !== "CONFIRM" && body.action !== "EDIT")) throw new WorkspaceError("INVALID", "Invalid confirmation");
    const edit = body.action === "EDIT" ? { field: body.field, action: "EDIT" as const, value: body.value } : { field: body.field, action: "CONFIRM" as const };
    const view = await confirmField(runtimeDeps(), { tenantId, sessionId, chartId: body.chartId, edit: edit as never, actor: "user", now: clockFrom(req.headers) });
    return NextResponse.json(view);
  } catch (e) {
    return errorResponse(e);
  }
}
