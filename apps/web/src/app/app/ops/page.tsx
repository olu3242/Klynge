import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { pageContext } from "@/server/http";
import { collectOpsReport, isOperator } from "@/server/ops/operator";
import { clockFrom, processDeps } from "@/server/runtime";
import type { MemorySessionStore } from "@/server/store/memory-store";

export const dynamic = "force-dynamic";

const iso = (t: number | null) => (t ? new Date(t).toISOString().replace(".000Z", "Z") : "—");

/** Operator readiness dashboard: aggregates only — no user identities, message content, formulas or credentials. */
export default async function OpsPage() {
  const ctx = await pageContext("/app/ops");
  if (ctx.identity.kind !== "USER" || !isOperator(ctx.identity, ctx.gateway.kind)) notFound();
  const p = processDeps();
  const r = collectOpsReport({ storeMode: p.storeMode, durable: (p.durable as MemorySessionStore | null) ?? null, account: p.account, market: ctx.deps.market ?? null }, clockFrom(await headers()));
  const tone = r.status === "OPERATIONAL" ? "success" : r.status === "DOWN" ? "danger" : "neutral";
  return (
    <AppShell active="ops" account={{ email: ctx.identity.user.email, authEnabled: true, operator: true }}>
      <h1 className="text-3xl font-extrabold tracking-tight">Operations</h1>
      <p className="mt-2 flex flex-wrap items-center gap-3 text-sm" data-testid="ops-status" data-status={r.status}>
        <Badge tone={tone}>{r.status}</Badge> engine {r.engineVersion} · rules {r.ruleVersion} · store {r.storeMode} · {r.scope === "IN_PROCESS" ? "all tenants (aggregated)" : "provider health only — hosted aggregates run off the request path"}
      </p>
      <p className="mt-2 text-sm">
        <a href="/app/ops/pilot" className="font-semibold text-k-lime">
          Pilot administration →
        </a>
      </p>
      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
        <Card aria-labelledby="inc-title" data-testid="ops-incidents">
          <CardTitle id="inc-title">Incidents</CardTitle>
          {r.incidents.length === 0 ? (
            <p className="mt-3 text-sm">No open incidents.</p>
          ) : (
            <ul className="mt-3 grid gap-2 text-sm">
              {r.incidents.map((i) => (
                <li key={`${i.code}-${i.severity}`} data-code={i.code}>
                  <Badge tone={i.severity === "CRITICAL" ? "danger" : "neutral"}>{i.severity}</Badge> {i.code} × {i.count} — {i.summary} <span className="text-k-secondary">Runbook: {i.runbook}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card aria-labelledby="prov-title" data-testid="ops-providers">
          <CardTitle id="prov-title">Providers and feeds</CardTitle>
          <ul className="mt-3 grid gap-1 text-sm">
            {r.providers.map((h) => (
              <li key={h.provider}>
                {h.provider}: {h.status} · last success {iso(h.lastSuccessAt)} {h.lastFailureCode ? `· last failure ${h.lastFailureCode}` : ""}
              </li>
            ))}
            {r.feeds.map((f) => (
              <li key={f.role}>
                {f.role} context feed: {f.licensed ? "licensed" : "NOT LICENSED (no substitution)"}
              </li>
            ))}
          </ul>
        </Card>
        <Card aria-labelledby="sess-title" data-testid="ops-sessions">
          <CardTitle id="sess-title">Sessions and runtime</CardTitle>
          <p className="mt-3 text-sm">
            Users {r.sessions.tenants} · DATA records {r.sessions.dataRecords} · VISUAL records {r.sessions.visualRecords} · runtime cursors {r.sessions.runtimeCursors} · stale {r.sessions.stale} · corrupted {r.sessions.corrupted} · provider failures (24 h) {r.runtimeFailures24h}
          </p>
        </Card>
        <Card aria-labelledby="del-title" data-testid="ops-delivery">
          <CardTitle id="del-title">Notification delivery</CardTitle>
          <p className="mt-3 text-sm">
            Delivered {r.delivery.delivered} · pending {r.delivery.pending} · dead letters {r.delivery.failed} · suppressed {r.delivery.suppressed} · oldest due {r.delivery.oldestDueMinutes ?? "—"} min · worker runs {r.delivery.workerRuns} (last {iso(r.delivery.lastRunAt)}) · lease conflicts {r.delivery.leaseLost}
          </p>
        </Card>
        <Card aria-labelledby="ing-title" data-testid="ops-ingestion">
          <CardTitle id="ing-title">Historical ingestion</CardTitle>
          <p className="mt-3 text-sm">{r.ingestion ? `Datasets ${r.ingestion.datasets} · unclean ${r.ingestion.unclean} · failing verification ${r.ingestion.unverified} · superseded ${r.ingestion.superseded}` : "No dataset store configured on this server."}</p>
        </Card>
        <Card aria-labelledby="aud-title" data-testid="ops-audit">
          <CardTitle id="aud-title">Audit events (counts)</CardTitle>
          <ul className="mt-3 grid gap-1 text-sm">
            {Object.entries(r.auditActions).map(([a, n]) => (
              <li key={a}>
                {a}: {n}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </AppShell>
  );
}
