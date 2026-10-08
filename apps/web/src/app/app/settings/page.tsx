import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { SettingsForm } from "@/components/settings-form";
import { requestContext } from "@/server/http";
import { getSettings } from "@/server/settings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const ctx = await requestContext();
  if (ctx.identity.kind !== "USER") redirect(`/sign-in?next=${encodeURIComponent("/app/settings")}`);
  const settings = await getSettings(ctx.deps.account, ctx.identity.tenantId);
  return (
    <AppShell active="settings" account={{ email: ctx.identity.user.email, authEnabled: true }}>
      <h1 className="text-3xl font-extrabold tracking-tight">Settings</h1>
      <p className="mt-2 max-w-2xl text-k-secondary">Your preferences can only narrow what Klynge shows you. They never turn WAIT or BLOCKED into a setup, and Klynge never places trades.</p>
      <SettingsForm initial={settings} verifiedEmail={ctx.identity.user.email} />
    </AppShell>
  );
}
