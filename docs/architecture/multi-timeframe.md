# Multi-Timeframe Context — `mtf-options-v1` (INTERNAL)

> INTERNAL. Never link from or paraphrase on public surfaces.

Source: `src/klynge/timeframe/`, `src/klynge/pipeline/`. Engine `0.3.0`.

## Roles (`hierarchy.ts`)
| Role | Default | Authority |
|---|---|---|
| MACRO | 1d (whole-session bucket) | highest |
| STRUCTURE | 1h | |
| SETUP | 15m (setup engine timeframe) | |
| EXECUTION | 5m | |
| REFINEMENT | 1m (optional) | lowest |

`assertValidTimeframePolicy` enforces the following:
- Timeframes strictly descend from MACRO to the finest role.
- Every intraday role is a multiple of the base, where the base is the finest role.
- `1d` is allowed only for MACRO or STRUCTURE.
- The pipeline also requires the SETUP timeframe to divide every session evenly.

## Synchronization: one feed, derived roles (`resample.ts`, `sync.ts`)
- Every role is **derived** from the base feed (session-anchored buckets), so roles cannot disagree about the underlying bars.
- **Forming bucket** (end > now): not available yet. The role uses its last *closed* candle. This is not an error.
- **Closed bucket missing base bars:** `MISSING_CANDLES`, so the context is unsynchronized and setups are BLOCKED.
- **Role freshness:** `now − lastClosedAt ≤ maxAgeByRole[role]`. The PROVISIONAL defaults are:

  | Role | Max age |
  |---|---|
  | MACRO / STRUCTURE | 4 days (valid across overnight and weekends) |
  | SETUP | 15m + 60s |
  | EXECUTION | 5m + 60s |
  | REFINEMENT | 1m + 60s |

- Base sessions are validated once: same symbol, ascending, non-overlapping, complete history, current session closed-candle rules. Sufficiency (≥ 21 candles) is checked per role on the derived, multi-session series.
- Timestamps are never required to match across roles; they only need to be compatible. A higher timeframe may lag a lower one.

## Multi-session warm-up (`engine/technical-state.ts`)
- `buildTechnicalState(session, { history })` concatenates validated prior sessions for EMA9, ATR14, swings/structure and relative volume.
- **VWAP still resets per session.** Without `history`, results are byte-identical to `setup-engine-v1`.
- Market truth (`spxHistory`, `mnqHistory`, `volumeProxyHistory`) and setup (`targetHistory`) accept history. In the setup engine the per-bar ATR is also warmed up, which affects level tolerance and price action.
- Role states use `assembleTechnicalState`, the same assembly path.
- Known limitation: on the 1d role, VWAP is the last daily bar's typical price (session-reset semantics).

## Higher-timeframe bias (`bias.ts`)
Each role's direction comes from the canonical strict `classifyDirection` of its TechnicalState.

| Macro × Structure | Bias |
|---|---|
| BULLISH + BULLISH | BULLISH |
| BEARISH + BEARISH | BEARISH |
| BULLISH + BEARISH (either order) | CONFLICTED |
| anything with NEUTRAL | NEUTRAL |

When the context is not synchronized, the bias is always NEUTRAL and the setup gate blocks on synchronization first.

## Setup integration (`triggers/setup-engine.ts`, optional `multiTimeframe` input)
The gate runs after target/regime alignment and **can only block or invalidate**.

| Condition | Result |
|---|---|
| Symbol / SETUP timeframe / clock mismatch | `INCONSISTENT_STATE` |
| Not synchronized | `UNSYNCHRONIZED_TIMEFRAMES` |
| Bias CONFLICTED or opposite the setup side | `HTF_CONFLICT` |
| NEUTRAL bias and `allowNeutralBias = false` | `HTF_NOT_APPROVED` (PROVISIONAL default: approved) |

- Each of these gives BLOCKED, or INVALIDATED when there is an active `previous` lifecycle.
- **Execution context** only ever downgrades CALL/PUT → WAIT:
  - `requireExecutionConfirmation = true` (default): the execution direction must equal the setup side.
  - `requireExecutionConfirmation = false`: the execution direction must merely not oppose it.
  - An opposing execution timeframe always gives WAIT and never reverses the setup.
- The decision carries `multiTimeframe { bias, synchronized, biasApproved, executionDirection, executionConfirmed }`, and `validateDecisionState` enforces it on every directional decision.

## Pipeline (`pipeline/mtf-pipeline.ts`)
1. Derive the SETUP-timeframe view of each feed (target, SPX, MNQ, proxy).
2. Run market truth with history.
3. Build `buildMultiTimeframeState(target)`.
4. Call `evaluateSetup` with the prior derived session (for levels), the target history and the MTF context.
