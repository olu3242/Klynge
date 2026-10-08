import { NextResponse } from "next/server";
import { MockEmailProvider } from "@/server/notifications/email";
import { processDeps } from "@/server/runtime";
import { isTestMode } from "@/server/test-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** TEST MODE ONLY: messages captured by the mock email provider (stands in for an inbox). 404 elsewhere. */
export async function GET(req: Request) {
  const email = processDeps().email;
  if (!isTestMode() || !(email instanceof MockEmailProvider)) return new NextResponse(null, { status: 404 });
  const to = new URL(req.url).searchParams.get("to") ?? "";
  return NextResponse.json(email.sent.filter((m) => m.to === to).map((m) => ({ subject: m.subject, text: m.text })));
}

/** TEST MODE ONLY: inject transient provider failures for the next N sends (retry/backoff certification). */
export async function POST(req: Request) {
  const email = processDeps().email;
  if (!isTestMode() || !(email instanceof MockEmailProvider)) return new NextResponse(null, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { failNext?: unknown };
  const n = typeof body.failNext === "number" && Number.isInteger(body.failNext) ? Math.max(0, Math.min(10, body.failNext)) : 0;
  email.failNext = n;
  return NextResponse.json({ failNext: n });
}
