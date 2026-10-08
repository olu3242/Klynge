import { NextResponse } from "next/server";
import { errorResponse, requestContext, withAccount } from "@/server/http";
import { clockFrom } from "@/server/runtime";
import { addJournalNote, getWorkspace, WorkspaceError } from "@/server/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { identity, deps, account } = await requestContext();
    const { tenantId, sessionId } = identity;
    const body = (await req.json()) as { recordId?: string; note?: string };
    if (!body.recordId || typeof body.note !== "string") throw new WorkspaceError("INVALID", "recordId and note are required");
    await addJournalNote(deps, { tenantId, recordId: body.recordId, note: body.note, author: "user", now: clockFrom(req.headers) });
    return NextResponse.json(withAccount(await getWorkspace(deps, tenantId, sessionId), account));
  } catch (e) {
    return errorResponse(e);
  }
}
