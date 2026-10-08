import { NextResponse } from "next/server";
import { exportAccount } from "@/server/account/privacy";
import { errorResponse, requestContext } from "@/server/http";
import { clockFrom } from "@/server/runtime";
import { WorkspaceError } from "@/server/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The verified user's own data (privacy rights hold even when pilot access is suspended or completed). */
export async function GET(req: Request) {
  try {
    const { identity, deps } = await requestContext({ pilotGate: false });
    if (identity.kind !== "USER") throw new WorkspaceError("AUTH_REQUIRED", "Sign in to export your data.");
    const body = await exportAccount(deps, identity.tenantId, identity.user.email, clockFrom(req.headers));
    return new NextResponse(JSON.stringify(body, null, 2), { headers: { "content-type": "application/json", "content-disposition": 'attachment; filename="klynge-account-export.json"', "cache-control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
