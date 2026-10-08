import { NextResponse } from "next/server";
import { mockOutbox } from "@/server/auth/mock-auth";
import { authMode } from "@/server/auth/select";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** TEST MODE ONLY: the latest mock magic link for an email (stands in for an inbox). 404 everywhere else. */
export async function GET(req: Request) {
  if (authMode() !== "mock") return new NextResponse(null, { status: 404 });
  const email = new URL(req.url).searchParams.get("email") ?? "";
  const link = mockOutbox.latest(email);
  return link ? NextResponse.json({ link }) : new NextResponse(null, { status: 404 });
}
