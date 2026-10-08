import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Public liveness probe. Deliberately exposes nothing else (no versions, providers or internals). */
export async function GET() {
  return NextResponse.json({ status: "ok" });
}
