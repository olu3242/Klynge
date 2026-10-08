import { NextResponse } from "next/server";
import { errorResponse, identity } from "@/server/http";
import { clockFrom, runtimeDeps } from "@/server/runtime";
import { addJournalNote, getWorkspace, WorkspaceError } from "@/server/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { tenantId, sessionId } = await identity();
    const body = (await req.json()) as { recordId?: string; note?: string };
    if (!body.recordId || typeof body.note !== "string") throw new WorkspaceError("INVALID", "recordId and note are required");
    await addJournalNote(runtimeDeps(), { tenantId, recordId: body.recordId, note: body.note, author: "user", now: clockFrom(req.headers) });
    return NextResponse.json(await getWorkspace(runtimeDeps(), tenantId, sessionId));
  } catch (e) {
    return errorResponse(e);
  }
}
