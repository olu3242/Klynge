import { NextResponse } from "next/server";
import { errorResponse, requestContext } from "@/server/http";
import { clockFrom } from "@/server/runtime";
import { getSettings, updateSettings } from "@/server/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { identity, deps } = await requestContext();
    return NextResponse.json(await getSettings(deps.account, identity.tenantId));
  } catch (e) {
    return errorResponse(e);
  }
}

/** Ownership and the email address come from the verified session — never from the body. */
export async function POST(req: Request) {
  try {
    const { identity, deps } = await requestContext();
    const body = await req.json().catch(() => ({}));
    return NextResponse.json(await updateSettings(deps.account, identity.tenantId, identity.kind === "USER" ? identity.user.email : null, body, clockFrom(req.headers)));
  } catch (e) {
    return errorResponse(e);
  }
}
