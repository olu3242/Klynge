# Market Truth Engine — `market-truth-v1` (INTERNAL)

> INTERNAL. Never link from, copy into, or paraphrase on public surfaces. See `docs/policies/public-boundary.md`.

Introduced in engine `0.1.0` / rules `market-truth-v1`; current engine `0.2.0` / `setup-engine-v1` (see `KLYNGE_RULE_HISTORY`). Source `src/klynge/`. Setup layer: `docs/architecture/setup-engine.md`.

## 1. Authority

```
DETERMINISTIC ENGINE  →  AGENT  →  USER
```

The engine is the only source of market truth. Agents explain, summarize, monitor, coordinate and surface
changes. They may not fabricate state, override MIXED/UNKNOWN, bypass BLOCKED, invent data or alter results.
Enforcement points: `deepFreeze` on all outputs, `checkAgentClaim()` (`agents/authority.ts`), and the
consistency checks inside `evaluateTradePermission()`. Those checks re-derive the regime from the directions,
so a forged `RISK_ON` is rejected with `INCONSISTENT_STATE`.

## 2. Data flow

```
TradingSession(SPX) ─┐                                  ┌─ TechnicalState(SPX) ─┐
                     ├─ assessSessionQuality ── valid? ─┤                       ├─ evaluateRegime ─┐
TradingSession(MNQ) ─┘        (per leg)                 └─ TechnicalState(MNQ) ─┘                  │
                                                    assessSnapshotSync (skew) ─ mergeDataQuality ──┤
                                                                                                   ▼
                                                                 evaluateTradePermission(regime, dataQuality)
                                                                                                   ▼
                                                     MarketTruthSnapshot { technical, dataQuality, regime,
                                                                           permission, provenance }  (frozen)
```

Entry point: `evaluateMarketTruth({ spx, mnq, now, policy? })` in `engine/market-truth.ts`.
If either leg fails validation, no indicators are computed for it. Regime is `UNKNOWN` and permission is `BLOCKED`.

## 3. Data-quality policy (`policies/data-quality-policy.ts`)

| Field | Default | Meaning |
|---|---|---|
| `maxStalenessMs` | 60 000 | Grace period after the *next* candle was due. Stale when `now − lastClose > tf + maxStalenessMs`. |
| `maxMarketSnapshotSkewMs` | 60 000 | Max \|SPX.ts − MNQ.ts\| before the regime is `UNKNOWN`. |
| `minimumTechnicalCandles` | 21 | Floored at `TECHNICAL_REQUIRED_CANDLES = 21` (ATR14 needs 15 bars; RVOL needs 20 prior bars + 1). |

Contract:
- Candles are **closed** bars. `timestamp` is the bar open (epoch ms).
- Any bar whose close is after `now` is rejected as `INCOMPLETE_CANDLE` (no lookahead).
- `now` is always explicit. ESLint forbids `Date.now()`, `new Date()` and `Math.random()` in `src/`.

Rejected per candle: high<low, open>high, open<low, close>high, close<low, negative volume, non-finite
OHLC or volume, empty symbol, invalid timestamp (non-safe-integer or ≤0), invalid timeframe.

Rejected per series:
- duplicate or out-of-order timestamps
- mixed symbols or timeframes
- gaps (`MISSING_CANDLES`) and bars off the timeframe grid
- insufficient history and staleness

Rejected per session:
- invalid boundaries
- bars outside `[open, close)`
- bars misaligned to the session open
- a leading gap at session open (`MISSING_CANDLES`, which matters because VWAP would be wrong)

Blocker codes (`domain/blockers.ts`) roll up into the absolute categories via `BLOCKER_CATEGORY`.

## 4. Indicators (pure, `indicators/`)

| Indicator | Definition |
|---|---|
| EMA(n) | Seed = SMA of the first n values; k = 2/(n+1); `ema[i] = v·k + ema[i−1]·(1−k)`. n = 9. |
| EMA slope | `ema[last] − ema[last−1]` (points per bar). Fewer than 2 values → 0. |
| True range | `max(H−L, |H−prevC|, |L−prevC|)`. Only bars with a previous close count. |
| ATR14 | **Simple mean** of the most recent 14 TRs. Not Wilder (a test enforces this). |
| Session VWAP | Σ(TP·V)/ΣV with TP = (H+L+C)/3. Resets per session. Undefined (null) when ΣV = 0. |
| Relative volume | current V ÷ mean V of the **20 prior** bars (current bar excluded). ≥1.5 STRONG, ≥1.2 CONFIRMING, ≥0.8 NORMAL, else WEAK. |

## 5. Structure (`structure/`)

- Swing high at i: `high[i]` is **strictly** greater than every high in `[i−L, i+L]` (L = 2). Swing lows mirror this with lows.
- A swing is only known at `confirmedAtIndex = i + L`, which is stored with `confirmedAtTimestamp`.
  `swingsKnownAt(swings, asOf)` gives the no-lookahead view.
- Classification uses the last two swing highs and the last two swing lows:
  - HH + HL → `HH_HL`
  - LH + LL → `LH_LL`
  - anything else, including ties or fewer than 2 of either → `MIXED`

## 6. Direction (strict, `engine/direction.ts`)

- `BULLISH` ⇔ price > VWAP **and** price > EMA9 **and** slope > 0 **and** structure = HH_HL
- `BEARISH` ⇔ price < VWAP **and** price < EMA9 **and** slope < 0 **and** structure = LH_LL
- Otherwise `NEUTRAL`. No voting, weighting or "3 of 4". NaN fails closed to `NEUTRAL`.

## 7. Regime (`regime/regime-engine.ts`)

Checks run in this order:
1. A non-finite timestamp → `UNKNOWN`.
2. Skew greater than `maxMarketSnapshotSkewMs` → `UNKNOWN` (`TIMESTAMP_SKEW`).
3. Mismatched timeframes → `UNKNOWN`.
4. BULLISH/BULLISH → `RISK_ON`, aligned.
5. BEARISH/BEARISH → `RISK_OFF`, aligned.
6. Everything else → `MIXED`, not aligned (`MIXED_REGIME`, `REGIME_NOT_ALIGNED`).

`MIXED` and `UNKNOWN` are always `aligned = false`.

## 8. Trade permission (`policies/trade-permission.ts`) — the ONLY implementation

Returns BLOCKED on any of the following:
- data invalid, stale, missing candles, skew, insufficient history, duplicates, out-of-order, malformed OHLC or negative volume
- any data-quality blocker
- regime `MIXED`, `UNKNOWN` or unrecognized
- `aligned ≠ true`
- any regime blocker
- a regime label inconsistent with the directions
- an unrecognized blocker code

ENABLED only when there are no blockers, regime ∈ {RISK_ON, RISK_OFF}, aligned, and the data is valid. It is fail-closed by construction.

### Absolute invariant (`policies/invariants.ts`)

```
NO_DATA | STALE_DATA | BAD_DATA | TIMESTAMP_SKEW | INSUFFICIENT_HISTORY | MIXED_REGIME | UNKNOWN_REGIME
  ⇒ BLOCKED, never downstream directional eligibility
```

Downstream modules (setup engine, options, alerts, agents) must gate on `isDirectionallyEligible()` or
`assertDirectionalEligibility()`. They must never re-derive regime or permission.

## 9. Determinism & provenance

- Identical input gives byte-identical output. A 100-run test enforces this.
- Outputs contain no wall-clock time, randomness or IDs.
- `provenance = { engineVersion, ruleVersion, evaluatedAt: now }`. Any change to rules or thresholds bumps `KLYNGE_RULE_VERSION`.

## 10. No-lookahead requirements (for replay, next phase)

- Feed the engine only bars with `timestamp + tf ≤ now` (enforced).
- Use swings only after `confirmedAtIndex` (metadata is present; replay must filter with `swingsKnownAt`).
- VWAP and RVOL use only the current and prior bars of the session (by construction).

## 11. Known gaps / operational notes

- **Index volume (resolved in 0.2.0):** many SPX feeds report zero volume. `MarketContextPolicy` assigns explicit roles:
  - SPX = `PRICE_STRUCTURE`
  - MNQ = `RISK_CONFIRMATION`
  - SPY (or ES) = optional `VOLUME_PROXY`

  The proxy must match `volumeProxySymbol` and be bar-aligned with SPX. It supplies **only** VWAP weights (applied to SPX typical prices) and relative volume. SPX still supplies price, EMA, ATR, structure and direction.

  A session passed in the wrong role (for example SPY as SPX) is `MIXED_SERIES`, which is BLOCKED. Provenance records `marketContext.broadMarketVolumeSource`. Without a proxy, zero SPX volume still fails closed.
- Indicators warm up within a single session, so the first 21 bars of each session are `INSUFFICIENT_HISTORY`. Multi-session warm-up is future work.
- Exchange calendars and holidays are not modeled. Session boundaries are supplied by the caller.
- Reserved, unimplemented modules: `options/`, `replay/`, `journal/`.
