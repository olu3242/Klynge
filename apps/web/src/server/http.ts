import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { IntakeError } from "./intake.ts";
import { WorkspaceError } from "./workspace.ts";

export const TENANT_COOKIE = "klynge_tenant";
export const SESSION_COOKIE = "klynge_session";

export async function identity(): Promise<{ tenantId: string; sessionId: string }> {
  const jar = await cookies();
  const tenantId = jar.get(TENANT_COOKIE)?.value;
  const sessionId = jar.get(SESSION_COOKIE)?.value;
  if (!tenantId || !sessionId) throw new WorkspaceError("NOT_FOUND", "No workspace session");
  return { tenantId, sessionId };
}

/** Error mapping that never echoes request bodies or image data. */
export function errorResponse(e: unknown): NextResponse {
  if (e instanceof WorkspaceError) {
    const status = e.code === "RATE_LIMITED" ? 429 : e.code === "NOT_FOUND" ? 404 : 400;
    return NextResponse.json({ error: e.message }, { status, headers: e.retryAfterMs ? { "retry-after": String(Math.ceil(e.retryAfterMs / 1000)) } : {} });
  }
  if (e instanceof IntakeError) return NextResponse.json({ error: e.message }, { status: e.code === "TOO_LARGE" ? 413 : 415 });
  console.error(`[api] ${(e as Error)?.name ?? "Error"}`);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}
