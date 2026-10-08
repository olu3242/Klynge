import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cmeEquityIndexCalendar, nyseCalendar } from "../calendar/exchange-calendars.ts";
import { bullFeeds, config, providerFor } from "../providers/provider-test-fixtures.ts";
import { MemoryRuntimeStore, runDataCycle } from "./live-runtime.ts";

const nyse = nyseCalendar();
const cfg = config({ calendar: nyse, calendars: { MNQ: cmeEquityIndexCalendar() } });
const run = (now: number) => runDataCycle({ provider: providerFor(bullFeeds()), store: new MemoryRuntimeStore() }, cfg, now);

describe("runtime × exchange calendar (fail closed, never fabricated)", () => {
  it("weekend / after hours => WAIT (MARKET_CLOSED), no decision", async () => {
    const o = await run(Date.parse("2026-10-10T15:00:00Z"));
    assert.equal(o.kind, "PROVIDER_FAILURE");
    assert.deepEqual(o.kind === "PROVIDER_FAILURE" && [o.permission, o.failures[0]!.code], ["WAIT", "MARKET_CLOSED"]);
  });
  it("exchange holiday => BLOCKED (SESSION_BOUNDARY)", async () => {
    const o = await run(Date.parse("2026-11-26T16:00:00Z"));
    assert.deepEqual(o.kind === "PROVIDER_FAILURE" && [o.permission, o.failures[0]!.code], ["BLOCKED", "SESSION_BOUNDARY"]);
  });
  it("outside the verified calendar coverage => BLOCKED", async () => {
    const o = await run(Date.parse("2028-02-01T16:00:00Z"));
    assert.deepEqual(o.kind === "PROVIDER_FAILURE" && [o.permission, o.failures[0]!.code], ["BLOCKED", "SESSION_BOUNDARY"]);
  });
  it("open market with bars on the wrong calendar => BLOCKED, never reshaped to fit", async () => {
    const o = await run(Date.parse("2026-10-07T16:00:00Z"));
    assert.equal(o.kind, "PROVIDER_FAILURE", "fixture bars are not on the NYSE/CME grid for this date");
    assert.equal(o.kind === "PROVIDER_FAILURE" && o.permission, "BLOCKED");
  });
});
