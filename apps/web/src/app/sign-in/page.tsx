import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Card, CardTitle } from "@/components/ui/card";
import { safeNext } from "@/server/auth/redirect";
import { authMode, gatewayFor } from "@/server/auth/select";
import { nextCookieJar } from "@/server/http";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  oauth: "Google sign-in could not be started. Try again.",
  email: "We could not send a sign-in link to that address.",
  link: "That sign-in link has expired or is invalid. Request a new one.",
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; sent?: string; error?: string }> }) {
  const q = await searchParams;
  const next = safeNext(q.next);
  const mode = authMode();
  if (mode !== "disabled" && (await gatewayFor(await nextCookieJar()).getUser())) redirect(next);
  return (
    <AppShell active="sign-in">
      <div className="mx-auto grid max-w-md gap-6">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Sign in to Klynge</h1>
          <p className="mt-2 text-k-secondary">Save analyses, keep a journal, receive alerts and connect verified market data. You can keep trying chart analysis without an account — trial analyses are not saved.</p>
        </div>
        {mode === "disabled" ? (
          <Card>
            <p role="note">Sign-in is not configured for this deployment. Chart analysis is available as a trial.</p>
          </Card>
        ) : (
          <Card aria-labelledby="signin-title">
            <CardTitle id="signin-title">Choose a sign-in method</CardTitle>
            {q.error && ERRORS[q.error] && (
              <p role="alert" className="mt-3 text-sm text-k-danger">
                ⚠ {ERRORS[q.error]}
              </p>
            )}
            {q.sent ? (
              <p role="status" className="mt-3 rounded-lg border border-k-lime/40 bg-k-lime/5 px-3 py-2 text-sm" data-testid="magic-link-sent">
                Check your email for a sign-in link.
              </p>
            ) : null}
            <form method="post" action="/auth/oauth/google" className="mt-4">
              <input type="hidden" name="next" value={next} />
              <button className="min-h-11 w-full rounded-lg bg-k-lime px-4 font-semibold text-k-black hover:bg-k-lime-bright">Continue with Google</button>
            </form>
            <div className="my-4 flex items-center gap-3 text-xs text-k-secondary" aria-hidden="true">
              <span className="h-px flex-1 bg-k-border" /> or <span className="h-px flex-1 bg-k-border" />
            </div>
            <form method="post" action="/auth/magic-link" className="grid gap-2">
              <input type="hidden" name="next" value={next} />
              <label htmlFor="email" className="text-xs font-semibold text-k-secondary">
                Email address
              </label>
              <input id="email" name="email" type="email" required autoComplete="email" className="input" />
              <button className="min-h-11 rounded-lg border border-k-border px-4 font-semibold hover:border-k-lime">Email me a sign-in link</button>
            </form>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
