import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { pageContext } from "@/server/http";
import { clockFrom } from "@/server/runtime";
import { statusReport } from "@/server/status";

export const dynamic = "force-dynamic";

const iso = (t: number | null) => (t ? new Date(t).toISOString().replace(".000Z", "Z") : "—");

export default async function StatusPage() {
  const ctx = await pageContext("/app/status");
  if (ctx.identity.kind !== "USER") redirect(`/sign-in?next=${encodeURIComponent("/app/status")}`);
  const s = await statusReport(ctx.deps.store, ctx.deps.account, ctx.deps.market, ctx.identity.tenantId, clockFrom(await headers()));
  return (
    <AppShell active="status" account={{ email: ctx.identity.user.email, authEnabled: true, operator: ctx.pilot.operator }}>
      <h1 className="text-3xl font-extrabold tracking-tight">Status</h1>
      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
        <Card aria-labelledby="provider-title" data-testid="status-provider">
          <CardTitle id="provider-title">Market data</CardTitle>
          {s.provider ? (
            <div className="mt-3 grid gap-2 text-sm">
              <p>
                {s.provider.label} {s.provider.live ? "" : "(offline fixture)"}
              </p>
              {s.provider.health.map((h) => (
                <p key={h.provider}>
                  <Badge tone={h.status === "HEALTHY" ? "success" : h.status === "UNKNOWN" ? "neutral" : "danger"}>{h.status}</Badge> {h.provider} · last success {iso(h.lastSuccessAt)}
                </p>
              ))}
              {s.provider.instruments.length > 0 && <p className="text-k-secondary">Licensed: {s.provider.instruments.map((i) => `${i.symbol} (${i.assetClass})`).join(", ")}</p>}
            </div>
          ) : (
            <p className="mt-3 text-sm">No market-data provider is configured.</p>
          )}
        </Card>
        <Card aria-labelledby="fresh-title" data-testid="status-freshness">
          <CardTitle id="fresh-title">Data freshness</CardTitle>
          {s.freshness.length === 0 ? (
            <p className="mt-3 text-sm text-k-secondary">No verified data analyses yet.</p>
          ) : (
            <ul className="mt-3 grid gap-1 text-sm">
              {s.freshness.map((f) => (
                <li key={f.symbol}>
                  {f.symbol}: {f.state.replace("_", " ").toLowerCase()} · latest bar {iso(f.latestBarAt)}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-sm">Provider failures (24 h): {s.runtimeFailures24h}</p>
        </Card>
        <Card aria-labelledby="notif-title" data-testid="status-notifications">
          <CardTitle id="notif-title">Notifications</CardTitle>
          <p className="mt-3 text-sm">
            Delivered {s.notifications.delivered} · pending {s.notifications.pending} · failed {s.notifications.failed} · suppressed duplicates {s.notifications.suppressed}
          </p>
        </Card>
        <Card aria-labelledby="audit-title" data-testid="status-audit">
          <CardTitle id="audit-title">Audit log</CardTitle>
          <ul className="mt-3 grid gap-1 text-sm">
            {s.audit.map((a) => (
              <li key={`${a.at}-${a.action}-${a.detail}`} className="break-words">
                {iso(a.at)} · {a.action} · {a.detail}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </AppShell>
  );
}
