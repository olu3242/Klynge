import { AccountData } from "@/components/account-data";
import { AppShell } from "@/components/app-shell";
import { PilotActivation } from "@/components/pilot-activation";
import { Card, CardTitle } from "@/components/ui/card";
import { requestContext } from "@/server/http";

export const dynamic = "force-dynamic";

const COPY: Record<string, { title: string; body: string }> = {
  NOT_INVITED: { title: "Klynge is in a private pilot", body: "Access is by invitation only. If you were invited, sign in with the address the invitation was sent to." },
  INVITED: { title: "You're invited to the Klynge pilot", body: "Before you start, please read and confirm the following." },
  ACTIVE: { title: "Your pilot access is active", body: "Open the workspace to continue." },
  SUSPENDED: { title: "Your pilot access is suspended", body: "Your account data is preserved. You can still export or delete it. Contact the Klynge pilot team for details." },
  COMPLETED: { title: "The pilot has ended for your account", body: "Thank you for taking part. You can still export or delete your data." },
};

/** Pilot enrollment page (Batch 71). Discloses only the caller's own state. */
export default async function PilotPage() {
  const ctx = await requestContext({ pilotGate: false });
  const signedIn = ctx.identity.kind === "USER";
  const state = signedIn ? (ctx.pilot.state ?? "NOT_INVITED") : "NOT_INVITED";
  const c = COPY[state]!;
  return (
    <AppShell active="pilot" account={{ email: signedIn ? ctx.account.email ?? null : null, authEnabled: ctx.account.authEnabled ?? false, operator: ctx.pilot.operator }}>
      <h1 className="text-3xl font-extrabold tracking-tight">Pilot access</h1>
      <Card aria-labelledby="pilot-title" className="mt-6 max-w-2xl" data-testid="pilot-state" data-state={state}>
        <CardTitle id="pilot-title">{c.title}</CardTitle>
        <p className="mt-2 text-sm text-k-secondary">{c.body}</p>
        {!signedIn && (
          <p className="mt-4">
            <a href="/sign-in?next=/pilot" className="rounded-lg bg-k-lime px-3 py-2 text-sm font-semibold text-k-black hover:bg-k-lime-bright">
              Sign in
            </a>
          </p>
        )}
        {signedIn && state === "INVITED" && <PilotActivation />}
        {signedIn && state === "ACTIVE" && (
          <p className="mt-4">
            <a href="/app" className="font-semibold text-k-lime">
              Open the workspace →
            </a>
          </p>
        )}
      </Card>
      {signedIn && (state === "SUSPENDED" || state === "COMPLETED") && <AccountData />}
    </AppShell>
  );
}
