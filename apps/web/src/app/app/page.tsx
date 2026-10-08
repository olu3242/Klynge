import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { Workspace } from "@/components/workspace";
import { SESSION_COOKIE, TENANT_COOKIE } from "@/server/http";
import { runtimeDeps } from "@/server/runtime";
import { getWorkspace } from "@/server/workspace";

export const dynamic = "force-dynamic";

export default async function WorkspacePage() {
  const jar = await cookies();
  const tenantId = jar.get(TENANT_COOKIE)?.value ?? "anonymous";
  const sessionId = jar.get(SESSION_COOKIE)?.value ?? "none";
  const initial = await getWorkspace(runtimeDeps(), tenantId, sessionId);
  return (
    <AppShell active="workspace">
      <Workspace initial={initial} />
    </AppShell>
  );
}
