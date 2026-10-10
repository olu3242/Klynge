# Klynge — Full-feature execution register

Scope: the trading-intelligence product in `olu3242/Klynge`, not the separate Scrum-agent product.
Baseline: development branch `claude/amazing-davinci-39fqur`.
Status vocabulary: SOURCE_PRESENT, PARTIAL, NOT_IMPLEMENTED, CERTIFIED, BLOCKED.
Source presence is not production certification. No profitability claims.

## Wave A — Engine and market truth (batches 01–10)
01 Verify market-data licensing, ticker coverage and entitlement matrix.
02 Verify live Polygon equity/index adapter; fail closed on missing API key.
03 Verify Databento CME MNQ feed, roll and exchange calendars.
04 Validate market freshness, clock skew, gaps and session boundaries.
05 Certify VWAP, EMA9/21, ATR and volume against reference fixtures.
06 Certify support/resistance, swings, break/retest/acceptance.
07 Certify SPX/MNQ regime and multi-timeframe agreement.
08 Certify risk vetoes, targets, invalidation and policy fingerprints.
09 Certify options contract eligibility; reject missing chain/greeks.
10 End-to-end live-provider smoke test in authorized sandbox, no trading.

## Wave B — BYoT/BYoC subscriber experience (batches 11–20)
11 Symbol search, validation and supported-instrument disclosures.
12 BYoT from verified data to deterministic decision card.
13 Chart upload validation, limits, privacy and removal.
14 Real extractor opt-in, bounded schema and prompt-injection resistance.
15 Per-field provenance, conflicting symbols and manual confirmations.
16 Visual-to-data handoff; visual evidence never emits actionable setup.
17 Session recovery, journal, history and export.
18 Risk preferences and account settings.
19 Responsive, accessible UX and errors/empty states.
20 Browser journeys across equity/index/futures and unsupported symbols.

## Wave C — Historical effectiveness and monitoring (batches 21–30)
21 Versioned historical datasets and corporate-action adjustments.
22 Replay no-lookahead and timestamp ordering.
23 Chronological holdout and walk-forward evaluation.
24 Costs, slippage, fills and contract sensitivity.
25 Signal outcome metrics with confidence intervals and sample sizes.
26 Separate paper performance from hypothetical backtests.
27 Alert state changes, dedupe and suppression.
28 Notification worker leases, fencing and retry/dead-letter handling.
29 Operator observability, incident runbooks and recovery.
30 Publish a reproducible evaluation report; no return guarantees.

## Wave D — Monetization and release (batches 31–40)
31 Confirm payment processor, USD 25/month price and tax/legal disclosures.
32 Hosted billing schema, tenant RLS, rollback and idempotent event ledger.
33 Authenticated checkout with server-owned user/customer mapping.
34 Verify webhook signatures against raw request bytes.
35 Reconcile out-of-order/duplicate events transactionally.
36 Subscription lifecycle and customer billing portal.
37 Enforce entitlement on every paid API/page; preserve approved pilot access.
38 Billing/authorization E2E using provider test mode.
39 Hosted RLS, live data, accessibility, security and operational drills.
40 Human approvals: migration, payment activation and deployment independently.

## Certification evidence required per batch
- Exact commit SHA and touched paths
- Typecheck/lint/unit/integration/browser results with counts
- Negative-path and tenant isolation tests
- Provider configuration, data rights and freshness proof when applicable
- Explicit BLOCKED/NO-GO when hosted prerequisites or approvals are absent

## Current implementation note
The deterministic trading engine, visual intake, provider adapters, auth, pilot, journal,
alerts and replay have source implementations, but hosted certification is outstanding.
Billing entitlement, event normalization and a pure reconciliation reducer exist;
no payment processor SDK, verified webhook, durable billing store, checkout or
paid API gate is wired as of this register. Do not activate subscriptions or deploy
without explicit authorization. The existing 0.8.0 release manifest must not be
silently amended to imply approval of subsequent changes.
