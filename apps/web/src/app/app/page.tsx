import { AppShell } from "@/components/app-shell";
import { FeedbackForm, Onboarding } from "@/components/pilot-panels";
import { Workspace } from "@/components/workspace";
import { pageContext, withAccount } from "@/server/http";
import { onboarding } from "@/server/pilot/pilot";
import { getWorkspace } from "@/server/workspace";

export const dynamic = "force-dynamic";

/** Workspace: open to anonymous TRIAL use (visual analysis only) unless invite-only; durable features require a verified user. */
export default async function WorkspacePage() {
  const ctx = await pageContext("/app");
  const initial = withAccount(await getWorkspace(ctx.deps, ctx.identity.tenantId, ctx.identity.sessionId), ctx.account);
  const guide = ctx.identity.kind === "USER" && ctx.deps.pilot ? await onboarding(ctx.deps, ctx.identity.tenantId, ctx.identity.sessionId) : null;
  return (
    <AppShell active="workspace" account={{ email: initial.account.email, authEnabled: initial.account.authEnabled, operator: ctx.pilot.operator }}>
      {guide && <Onboarding initial={guide} />}
      <Workspace initial={initial} />
      {ctx.identity.kind === "USER" && ctx.deps.pilot && <FeedbackForm recordId={initial.latestRecordId ?? null} />}
    </AppShell>
  );
}
