import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { pageContext } from "@/server/http";
import { history } from "@/server/workspace";

export const dynamic = "force-dynamic";

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ symbol?: string }> }) {
  const { symbol } = await searchParams;
  const ctx = await pageContext("/app/history");
  // Protected: history is tenant-owned durable data — a verified user only.
  if (ctx.identity.kind !== "USER") redirect(`/sign-in?next=${encodeURIComponent("/app/history")}`);
  const rows = await history(ctx.deps, ctx.identity.tenantId, symbol?.toUpperCase() || undefined);
  return (
    <AppShell active="history" account={{ email: ctx.identity.user.email, authEnabled: true, operator: ctx.pilot.operator }}>
      <h1 className="text-3xl font-extrabold tracking-tight">History{symbol ? ` · ${symbol.toUpperCase()}` : ""}</h1>
      <form className="mt-4 flex max-w-sm gap-2" action="/app/history">
        <label htmlFor="symbol" className="sr-only">
          Filter by symbol
        </label>
        <input id="symbol" name="symbol" defaultValue={symbol ?? ""} placeholder="Filter by symbol" className="input" />
        <button className="rounded-lg border border-k-border px-3 text-sm font-semibold hover:border-k-lime">Filter</button>
      </form>
      <Card className="mt-6 overflow-x-auto">
        <CardTitle>Analyses</CardTitle>
        {rows.length === 0 ? (
          <p className="mt-3 text-sm text-k-secondary">No analyses yet.</p>
        ) : (
          <table className="mt-3 w-full min-w-[520px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-k-secondary">
              <tr>
                <th className="py-2">When</th>
                <th>Symbol</th>
                <th>Evidence</th>
                <th>State</th>
                <th>Permission</th>
                <th>Notes</th>
                <th>Origin</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.recordId} className="border-t border-k-border">
                  <td className="py-2">{new Date(r.at).toISOString().replace(".000Z", "Z")}</td>
                  <td>{r.symbol}</td>
                  <td>
                    <Badge tone={r.evidenceMode === "DATA" ? "lime" : "warning"}>
                      <span aria-hidden="true">{r.evidenceMode === "DATA" ? "◆" : "◐"}</span> {r.evidenceMode === "DATA" ? "Data" : "Visual"}
                    </Badge>
                  </td>
                  <td>{r.state}</td>
                  <td>{r.permission}</td>
                  <td>{r.notes}</td>
                  <td>{r.origin === "ANONYMOUS_TRIAL" ? "Saved trial" : "Account"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </AppShell>
  );
}
