import { NextResponse } from "next/server";
import { deleteAccount } from "@/server/account/privacy";
import { errorResponse, requestContext } from "@/server/http";
import { processDeps } from "@/server/runtime";
import type { MemorySessionStore } from "@/server/store/memory-store";
import { WorkspaceError } from "@/server/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Deletes the verified user's own data (in-process stores). Requires an explicit typed confirmation. */
export async function POST(req: Request) {
  try {
    const { identity } = await requestContext({ pilotGate: false });
    if (identity.kind !== "USER") throw new WorkspaceError("AUTH_REQUIRED", "Sign in to delete your data.");
    const body = (await req.json().catch(() => ({}))) as { confirmation?: unknown };
    const p = processDeps();
    return NextResponse.json(deleteAccount({ durable: (p.durable as MemorySessionStore | null) ?? null, account: p.account, pilot: p.pilot, images: p.images }, identity.tenantId, body.confirmation));
  } catch (e) {
    return errorResponse(e);
  }
}
