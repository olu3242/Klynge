# Visual intake (INTERNAL) — `visual-intake-v1`, engine 0.4.0

User-supplied charts are the primary input. A chart image is evidence of what was **visible**, never market data.

```
CHART → INTAKE → EXTRACTION (agent) → VALIDATION → MISSING-CONTEXT → USER CONFIRMATION → NORMALIZED SNAPSHOT → ENGINE
```

## Evidence modes
| Mode | Source | Can produce | Vocabulary |
|---|---|---|---|
| `VISUAL` | screenshots | context only | BULLISH / BEARISH / MIXED / INSUFFICIENT CONTEXT; permission **WAIT** or **BLOCKED** |
| `DATA` | OHLCV import (later: providers) | the full pipeline | CALL_SETUP / PUT_SETUP / WAIT / BLOCKED / INVALIDATED |

**VISUAL cannot pretend to be DATA.** Enforced in three places:
`validateDecisionState` (directional decisions require `evidenceMode: "DATA"`), `evaluateOptions` (`VISUAL_EVIDENCE` ⇒ BLOCKED),
and `checkAgentVisualClaim` (agents cannot claim CALL/PUT or DATA_VERIFIED for visual context). Every visual result
carries the notice *"Conditions observed — data verification required"*.

## Provenance (per field)
`DATA_VERIFIED | OBSERVED | USER_CONFIRMED | NOT_VISIBLE | NOT_PROVIDED | NOT_VERIFIED`.
- Extractors may only emit `OBSERVED` or `NOT_VISIBLE` (schema-enforced); anything else is downgraded to `NOT_VERIFIED`.
- Missing fields ⇒ `NOT_PROVIDED`. Confidence below `minimumConfidence` ⇒ `NOT_VERIFIED`. Unsupported keys (ATR, baselines…) are dropped and reported.
- Cross-checks (OBSERVED only): last price inside the visible axis range; VWAP relation needs a visible VWAP; level placement.
- User confirmation ⇒ `USER_CONFIRMED` with an audit entry. **USER_CONFIRMED never becomes DATA_VERIFIED.**
- `DATA_VERIFIED` is produced only by `buildDataSnapshot`.
- Never derivable from an image (always listed as not verified): ATR14, relative-volume baseline, exact EMA/VWAP values, R:R.

## Session
Roles TARGET / SPX / MNQ (required) and VOLUME_PROXY (optional), detected from the symbol via the market-context policy.
A user role override that contradicts the symbol is a `ROLE_VIOLATION` (BLOCKED). One chart per role; newest replaces.
Capture time = upload time unless the chart time is user-confirmed (`AXIS_CONFIRMED`).

Visual policy (PROVISIONAL): `minimumConfidence 0.7`, `maxChartSetSkewMs 5 min`, `maxChartAgeMs 15 min`.

## Visual context rule
Per chart: BULLISH ⇔ price ABOVE VWAP ∧ structure HH_HL ∧ (no usable labelled EMA ∨ price ABOVE it); BEARISH mirrors; else NEUTRAL.
SPX + MNQ directions feed the canonical `regimeFromDirections` table. Blockers: ROLE_VIOLATION, TIMESTAMP_SKEW,
FUTURE_CAPTURE, STALE_DATA, MIXED_REGIME, TARGET_REGIME_CONFLICT. Incomplete required context ⇒ INSUFFICIENT CONTEXT / WAIT.

## Snapshot + persistence
`NormalizedSnapshot { snapshotId, evidenceMode, … }` — VISUAL ⇒ `evaluateVisualContext`; DATA ⇒ `evaluateMultiTimeframeSetup`.
Records are immutable and idempotent on `snapshotId`. DATA imports chain the latest persisted DATA decision for the symbol
with `at < asOf` as `previous`, so an active setup can be INVALIDATED, never silently reversed.
Alerts (`detectDecisionChange`, `detectVisualChange`) are deterministic, idempotent on `alertId`, and in-app only.
Journal notes annotate records and never mutate them (`checkAgentJournalAction`: explain/summarize only).

## App (`apps/web`)
- Intake: magic-byte sniff (declared type ignored), 10 MB cap, auto-orient, ≤ 2576 px long edge, re-encode **without metadata**.
- Retention: `SESSION` (processed image in memory until reset) or `NONE`. Images never reach the database or logs.
- Extractors: `mock` (recorded corpus, default; CI/tests) or `claude` (structured output, server-only credentials).
  Image text is treated as chart content, never instructions.
- Engine is `server-only`; ESLint forbids client imports; `bundle:check` scans browser chunks for engine markers and secrets.
- Rate limit: token bucket per tenant (PROVISIONAL 20 burst, 20/h). Telemetry: allow-listed attributes, hashed tenant.

## Accuracy harness
`test/corpus/`: synthetic images, golden labels, `recorded/mock` (hand-authored, deliberately imperfect — NOT model output).
`scoreCorpus` reports per-field correct/wrong/abstained, calibration buckets and **confident errors** (passed validation, wrong).
Live re-record (`npm run corpus:record`, or the manual `corpus-record` workflow via WIF) is never part of CI.

## Known gaps
Authentication (tenant is a pseudonymous cookie; RLS assumes `auth.uid()`), pixel-level redaction of account details,
real-model accuracy (needs a live recording), data providers / live mode (Batches 41–50).
