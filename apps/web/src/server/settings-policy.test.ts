import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { MemoryAccountStore } from "./account/memory-account-store.ts";
import { MockEmailProvider } from "./notifications/email.ts";
import { getSettings, updateSettings } from "./settings.ts";
import { statusReport } from "./status.ts";
import { FIXTURE_END, marketDeps, OHLCV_FIXTURE, testDeps, USER_A } from "./test-support.ts";
import { connectData, getWorkspace, importOhlcv, WorkspaceError } from "./workspace.ts";

const SID = "abababab-abab-4bab-abab-abababababab";
const fixture = JSON.parse(readFileSync(OHLCV_FIXTURE, "utf8")) as Record<string, unknown>;
const withAccount = <T extends object>(d: T) => ({ ...d, account: new MemoryAccountStore(), email: new MockEmailProvider() });

describe("settings: validated, verified-email only, audited", () => {
  it("requires a verified account; rejects malformed preferences", async () => {
    await assert.rejects(getSettings(null, USER_A), (e: unknown) => e instanceof WorkspaceError && e.code === "AUTH_REQUIRED");
    const a = new MemoryAccountStore();
    await assert.rejects(updateSettings(a, USER_A, "ada@example.com", { riskPolicy: { maxLossPerTrade: -1 } }, 1), /positive amount/);
    await assert.rejects(updateSettings(a, USER_A, null, { notifications: { emailEnabled: true } }, 1), /no verified email/);
    await assert.rejects(updateSettings(a, USER_A, "ada@example.com", { notifications: { emailEnabled: true, maxPerHour: 500 } }, 1), /Invalid notification/);
  });
  it("the address is the verified auth email, never a submitted one", async () => {
    const a = new MemoryAccountStore();
    const s = await updateSettings(a, USER_A, "ada@example.com", { notifications: { emailEnabled: true, address: "victim@example.com", minSeverity: "INFO" } }, 1);
    assert.equal(s.notifications.emailAddress, "ada@example.com");
    assert.deepEqual((await a.listAudit(USER_A)).map((e) => e.action), ["notifications.updated"]);
  });
});

describe("user policy veto precedence (engine decision unchanged; veto stored separately)", () => {
  it("CALL_SETUP + restrictive preferences => vetoed for the user, decision record still CALL_SETUP", async () => {
    const deps = withAccount(testDeps());
    await updateSettings(deps.account, USER_A, "ada@example.com", { riskPolicy: { allowedInstruments: ["NVDA"] } }, 1);
    const v = await importOhlcv(deps, { tenantId: USER_A, sessionId: SID, json: fixture, now: FIXTURE_END });
    assert.equal(v.data?.decision, "CALL_SETUP");
    assert.equal(v.data?.userPolicy?.withinUserPolicy, false);
    assert.deepEqual(v.data?.userPolicy?.vetoes.map((x) => x.code), ["INSTRUMENT_NOT_ALLOWED"]);
    const rec = (await deps.store.listRecords(USER_A)).find((r) => r.evidenceMode === "DATA")!;
    assert.equal(rec.data?.decision, "CALL_SETUP", "engine record untouched");
    assert.equal((await deps.account.listVerdicts(USER_A))[0]!.recordId, rec.recordId);
  });
  it("engine BLOCKED + the most permissive preferences => still BLOCKED, nothing to veto", async () => {
    const deps = withAccount(testDeps());
    await updateSettings(deps.account, USER_A, "ada@example.com", { riskPolicy: { optionsRiskAcknowledged: true } }, 1);
    const spx = structuredClone(fixture.spx) as { candles: { high: number; low: number }[] }[];
    const bar = spx.at(-1)!.candles.at(-1)!;
    bar.high = bar.low - 1;
    const v = await importOhlcv(deps, { tenantId: USER_A, sessionId: SID, json: { ...fixture, spx }, now: FIXTURE_END });
    assert.equal(v.data?.decision, "BLOCKED");
    assert.deepEqual([v.data?.userPolicy?.withinUserPolicy, v.data?.userPolicy?.vetoes], [false, []]);
  });
});

describe("notifications from real alert paths + operational status", () => {
  it("connecting verified data with email opt-in delivers sanitized emails once; status reports it", async () => {
    const deps = withAccount(marketDeps());
    await updateSettings(deps.account, USER_A, "ada@example.com", { notifications: { emailEnabled: true, minSeverity: "INFO" } }, 1);
    await connectData(deps, { tenantId: USER_A, sessionId: SID, symbol: "TSLA", now: FIXTURE_END });
    await connectData(deps, { tenantId: USER_A, sessionId: SID, symbol: "TSLA", now: FIXTURE_END + 60_000 });
    const subjects = deps.email.sent.map((m) => m.subject);
    assert.ok(subjects.some((s) => /CALL SETUP/.test(s)));
    assert.equal(new Set(subjects).size, subjects.length, "no duplicates");
    assert.ok(deps.email.sent.every((m) => m.to === "ada@example.com" && /not financial advice/.test(m.text)));
    const s = await statusReport(deps.store, deps.account, deps.market, USER_A, FIXTURE_END + 120_000);
    assert.equal(s.notifications.delivered, deps.email.sent.length);
    assert.equal(s.freshness[0]!.symbol, "TSLA");
    assert.ok(s.audit.some((e) => e.action === "data.connected"));
    assert.equal(s.provider?.live, false);
    const ws = await getWorkspace(deps, USER_A, SID);
    assert.equal(ws.data?.userPolicy?.withinUserPolicy, true);
  });
});
