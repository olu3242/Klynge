# BYoC + BYoT unified journey implementation contract

Status: implementation specification; **not** production certification.

## Canonical modes
- **BYoC** (Bring Your Own Chart): upload a current screenshot from any broker/charting app. No broker connection required. Use existing `VISUAL` intake, extraction, field provenance, and `evaluateVisualContext`. Return directional context, observable levels, evidence, missing inputs, and WAIT/BLOCKED only. Never represent screenshot values as live market quotes.
- **BYoT** (Bring Your Own Ticker): enter a symbol and resolve its instrument class, provider entitlement, quote/bar freshness, and licensed historical OHLCV. Use existing `DATA` pipeline and canonical risk/permission engine. If provider unavailable, blocked, unlicensed, stale or unsupported, return explicit status, never mock as live.
- **Combined**: upload chart plus enter ticker; run both independent intake paths and cross-check symbol, instrument, timeframe, timestamps, price and visible levels. Keep per-field source provenance. Disagreements generate explicit discrepancy and WAIT/BLOCKED; never silently overwrite screenshot observations with provider data. Only independently verified DATA can produce a setup.

## UX
Present three clear entry tabs (Upload chart / Enter ticker / Combine both) within the existing workspace. Reuse the existing workspace server actions, API handlers, rate limits, sessions, and persisted immutable decisions. Display source badge (VISUAL or DATA), last observation time, data age, provenance, missing inputs, blockers, invalidation and risk. Chart upload should accept broker screenshots without brokerage credentials.

## Implementation sequence
1. Audit current workspace and API routes; preserve existing engine boundaries.
2. Implement a discriminated mode model and validated request contract.
3. Add accessible three-way mode selection; preserve existing standalone flows.
4. Add combined orchestration service using existing extractors and market providers; no duplicate technical-analysis algorithm.
5. Add comparison of symbol, timestamps, timeframe and visible price/levels; enforce conflict handling and freshness gates.
6. Persist immutable records per authenticated tenant with RLS; respect SESSION/NONE image retention and metadata stripping.
7. Test VISUAL-only WAIT/BLOCKED, DATA-only setup eligibility, combined match/conflict, stale/missing entitlement, wrong ticker, missing timeframe, multi-tenant denial, prompt injection in image, duplicate request and rate limiting.
8. Run `npm run check` and `npm run check:app`, hosted RLS certification and real browser E2E before release.

## Release constraints
Do not activate Stripe, production email, GA, or automated order execution. No schema migration or production environment change without separate approval. Never expose server-only secrets. No chart-derived CALL_SETUP or PUT_SETUP. SPX/MNQ remain unavailable unless actually licensed, never substituted with a proxy. Do not claim success based on mocks alone.

## Acceptance
A real broker screenshot can be submitted and analyzed with honest VISUAL limits; a supported licensed ticker can produce DATA analysis; combined analysis flags discrepancies and only DATA-verified results may be actionable. Hosted release remains NO-GO until independently tested.
