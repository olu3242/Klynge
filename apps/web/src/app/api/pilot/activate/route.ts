import { NextResponse } from "next/server";
import { errorResponse, requestContext } from "@/server/http";
import { activatePilot } from "@/server/pilot/pilot";
import { clockFrom } from "@/server/runtime";
import { WorkspaceError } from "@/server/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Invite-only activation (Batch 71). Identity and email come from the verified session — never from the body. */
export async function POST(req: Request) {
  try {
    const { identity, deps } = await requestContext({ pilotGate: false });
    if (identity.kind !== "USER") throw new WorkspaceError("AUTH_REQUIRED", "Sign in with your invited address.");
    const body = (await req.json().catch(() => ({}))) as { riskAcknowledged?: unknown; consent?: unknown };
    const e = await activatePilot(deps, { tenantId: identity.tenantId, email: identity.user.email, riskAcknowledged: body.riskAcknowledged, consent: body.consent, now: clockFrom(req.headers) });
    return NextResponse.json({ status: e.status, cohort: e.cohort });
  } catch (e) {
    return errorResponse(e);
  }
}
