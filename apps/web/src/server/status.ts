import type { AccountStore } from "./account/types.ts";
import type { MarketDataSetup } from "./market-data.ts";
import type { SessionStore } from "./store/types.ts";

/** Operational health for ONE verified user: provider status, data freshness, delivery, audit. No internals. */
export interface StatusReport {
  provider: { label: string; live: boolean; health: { provider: string; status: string; lastSuccessAt: number | null; lastFailureCode: string | null }[]; instruments: { symbol: string; assetClass: string }[] } | null;
  freshness: { symbol: string; latestBarAt: number; ageMinutes: number; state: "FRESH" | "STALE" | "MARKET_CLOSED" }[];
  runtimeFailures24h: number;
  notifications: { pending: number; delivered: number; failed: number; suppressed: number };
  audit: { at: number; action: string; detail: string }[];
}

export async function statusReport(store: SessionStore, account: AccountStore | null | undefined, market: MarketDataSetup | null | undefined, tenantId: string, now: number): Promise<StatusReport> {
  const records = (await store.listRecords(tenantId)).filter((r) => r.evidenceMode === "DATA" && r.data);
  const latest = new Map<string, number>();
  for (const r of records) latest.set(r.symbol, Math.max(latest.get(r.symbol) ?? 0, r.marketTimestamp ?? r.at));
  const cal = market?.calendar;
  const freshness = [...latest].map(([symbol, latestBarAt]) => {
    const age = now - latestBarAt;
    const closed = cal?.status ? cal.status(now) !== "OPEN" : false;
    return { symbol, latestBarAt, ageMinutes: Math.floor(age / 60_000), state: closed ? ("MARKET_CLOSED" as const) : age > 20 * 60_000 ? ("STALE" as const) : ("FRESH" as const) };
  });
  const alerts = await store.listAlerts(tenantId);
  const outbox = account ? await account.listOutbox(tenantId) : [];
  const count = (s: string) => outbox.filter((o) => o.status === s).length;
  return {
    provider: market
      ? { label: market.label, live: market.live, health: (market.health?.() ?? []).map((h) => ({ provider: h.provider, status: h.status, lastSuccessAt: h.lastSuccessAt, lastFailureCode: h.lastFailureCode })), instruments: (market.entitlements ?? []).map((e) => ({ symbol: e.canonicalSymbol, assetClass: e.assetClass })) }
      : null,
    freshness: freshness.sort((a, b) => a.symbol.localeCompare(b.symbol)),
    runtimeFailures24h: alerts.filter((a) => a.event === "PROVIDER_FAILURE" && now - a.at < 86_400_000).length,
    notifications: { pending: count("PENDING"), delivered: count("DELIVERED"), failed: count("FAILED"), suppressed: count("SUPPRESSED") },
    audit: account ? (await account.listAudit(tenantId, 20)).map((e) => ({ at: e.at, action: e.action, detail: e.detail })) : [],
  };
}
