import { AppShell } from "@/components/app-shell";
import { Workspace } from "@/components/workspace";
import { requestContext, withAccount } from "@/server/http";
import { getWorkspace } from "@/server/workspace";

export const dynamic = "force-dynamic";

/** Workspace: open to anonymous TRIAL use (visual analysis only); durable features require a verified user. */
export default async function WorkspacePage() {
  const ctx = await requestContext();
  const initial = withAccount(await getWorkspace(ctx.deps, ctx.identity.tenantId, ctx.identity.sessionId), ctx.account);
  return (
    <AppShell active="workspace" account={{ email: initial.account.email, authEnabled: initial.account.authEnabled }}>
      <Workspace initial={initial} />
    </AppShell>
  );
}
