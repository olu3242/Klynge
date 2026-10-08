import { NextResponse } from "next/server";
import { errorResponse, identity } from "@/server/http";
import { MAX_UPLOAD_BYTES } from "@/server/intake";
import { clockFrom, runtimeDeps } from "@/server/runtime";
import { uploadChart, WorkspaceError } from "@/server/workspace";
import type { ExtractionHints } from "@/server/extraction/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"];
const ROLES = ["TARGET", "SPX", "MNQ", "VOLUME_PROXY"];

export async function POST(req: Request) {
  try {
    const { tenantId, sessionId } = await identity();
    const declared = Number(req.headers.get("content-length") ?? 0);
    if (declared > MAX_UPLOAD_BYTES + 64 * 1024) throw new WorkspaceError("INVALID", "Upload too large");
    const form = await req.formData();
    const file = form.get("chart");
    if (!(file instanceof File)) throw new WorkspaceError("INVALID", "Attach a chart image");
    const hints: ExtractionHints = {};
    const symbol = String(form.get("symbol") ?? "").trim().toUpperCase();
    const timeframe = String(form.get("timeframe") ?? "");
    const role = String(form.get("role") ?? "");
    if (symbol) hints.symbol = symbol;
    if (TIMEFRAMES.includes(timeframe)) hints.timeframe = timeframe as ExtractionHints["timeframe"] & string;
    if (ROLES.includes(role)) hints.role = role as ExtractionHints["role"] & string;
    const view = await uploadChart(runtimeDeps(), { tenantId, sessionId, bytes: new Uint8Array(await file.arrayBuffer()), hints, actor: "user", now: clockFrom(req.headers) });
    return NextResponse.json(view);
  } catch (e) {
    return errorResponse(e);
  }
}
