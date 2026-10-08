import { NextResponse } from "next/server";
import { errorResponse, requestContext } from "@/server/http";
import { submitFeedback } from "@/server/pilot/pilot";
import { clockFrom } from "@/server/runtime";
import { WorkspaceError } from "@/server/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Structured feedback (Batch 74). Stored as USER_REPORTED; it can never change a decision. */
export async function POST(req: Request) {
  try {
    const { identity, deps } = await requestContext();
    if (identity.kind !== "USER") throw new WorkspaceError("AUTH_REQUIRED", "Sign in to send feedback.");
    const f = await submitFeedback(deps, { tenantId: identity.tenantId, sessionId: identity.sessionId, body: await req.json().catch(() => ({})), now: clockFrom(req.headers) });
    return NextResponse.json({ feedbackId: f.feedbackId, kind: f.kind }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
