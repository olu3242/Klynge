# Pilot readiness certification: `pilot-readiness-v1` (engine 0.7.0)

Status keys: **LOCALLY CERTIFIED** means offline fixtures, local PostgreSQL and the browser E2E harness.
**HOSTED / LIVE** means a hosted Supabase project or licensed live providers. Hosted and live certification run
separately, only when authorized and configured. A blocked environment is never reported as passing.

| # | Journey | Local evidence | Local | Hosted / live |
|---|---|---|---|---|
| 1 | Anonymous chart upload → visual context | e2e §1 (INSUFFICIENT CONTEXT → BULLISH CONTEXT, WAIT, no directional language) | LOCALLY CERTIFIED | n/a |
| 2 | Sign-in → explicit trial promotion | e2e §4 (nothing copied before "Save to my account") | LOCALLY CERTIFIED | BLOCKED (hosted Auth) |
| 3 | Authenticated saved session → RLS isolation | e2e §5/§8; `test/rls/rls.test.ts`, `rls-account.test.ts`, `migrations.test.ts` | LOCALLY CERTIFIED | BLOCKED (`npm run rls:hosted`, needs approval + access) |
| 4 | Verified data connection → deterministic evaluation | e2e §7 (DATA VERIFIED, CALL_SETUP, idempotent UNCHANGED) | LOCALLY CERTIFIED (mock provider) | BLOCKED (no provider credentials) |
| 5 | SPX + MNQ + target ticker alignment | e2e §1/§7 provenance; `cme-provider.test.ts` (Polygon + CME front contract → DATA_VERIFIED, MNQ provenance CME:MNQ) | LOCALLY CERTIFIED | BLOCKED (no Polygon/Databento license in this environment) |
| 6 | Missing/stale provider data → WAIT/BLOCKED | e2e §3/§9 (stale, missing bar, outage → BLOCKED); engine provider + calendar tests | LOCALLY CERTIFIED | BLOCKED (live) |
| 7 | Visual → DATA without evidence contamination | e2e §5/§7 (visual card stays WAIT/BLOCKED; transition banner); engine handoff tests | LOCALLY CERTIFIED | n/a |
| 8 | Risk policy veto without modifying engine truth | e2e §10b (CALL_SETUP unchanged, `user-policy` outside limits); `rls-account.test.ts` verdicts append-only | LOCALLY CERTIFIED | BLOCKED (hosted) |
| 9 | Runtime restart → previous decision restored | e2e §10 (real process restart, file store) | LOCALLY CERTIFIED | BLOCKED (hosted) |
| 10 | Alert generation → hosted worker → delivery/retry | e2e J10 (inline failure → backoff → worker → exactly once); `notification-worker.test.ts`; `test/rls/notification-worker.test.ts` (SKIP LOCKED, fencing, confirmed recipients) | LOCALLY CERTIFIED | BLOCKED (migration 0003 not applied; no Resend key) |
| 11 | Historical replay → reproducible results | `evaluation/empirical.test.ts` (report hash, sealed holdout); `history-pipeline.test.ts` (replay from stored datasets identical); `history-versions.test.ts` | LOCALLY CERTIFIED (synthetic harness) | BLOCKED (no licensed historical data) |
| 12 | Cross-user access and privilege-escalation denial | e2e §8 + J12 (forged ids/headers → 404); `migrations.test.ts` escalation; `service-role.test.ts` | LOCALLY CERTIFIED | BLOCKED (hosted) |

## Constitutional invariants (tested)
- Screenshot-only analysis never yields CALL_SETUP/PUT_SETUP: engine visual tests and e2e §1/§12.
- VISUAL never becomes DATA_VERIFIED: engine provenance tests and e2e §5.
- SPX truth and MNQ confirmation stay distinct, with no substitution: `routing` tests, `cme-provider.test.ts`, the
  `MISSING_FEED` incident.
- Options never create setups: e2e §7 and engine options tests.
- User policies only restrict: e2e §10b and `settings-policy.test.ts`.
- No verified user means no durable session: e2e §2 and `tenancy.test.ts`.
- Service role ≠ user authorization: the `service-role.test.ts` source scan plus lint.
- No lookahead, no fabricated data, no performance claims: backtest and evaluation tests, ingestion gap tests.
- No engine internals or credentials in browser bundles: `bundle:check` and the bundle-guard tests (0.5.0–0.7.0
  markers).

## Defect found during certification
Journey 10 found that `notificationId` (also the provider idempotency key) was derived from the alert id only. Two
users receiving the same alert therefore collided, and the provider would deduplicate the second user's email. The
key is now `hash(tenantId | alertId | channel)`, with a regression test in `notification-worker.test.ts`.

## Pilot operational status
**Not operational.** Hosted Auth/RLS, licensed market data (SPX via Polygon/Massive, MNQ via CME Globex) and hosted
runtime recovery are unverified in a hosted environment. Activation needs explicit approval of the hosted
migrations (0001–0003), hosted RLS certification, licensed provider credentials and a scheduled worker.
