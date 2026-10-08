# Setup Engine — `setup-engine-v1` (INTERNAL)

> INTERNAL. Never link from, copy into, or paraphrase on public surfaces. See `docs/policies/public-boundary.md`.

Engine `0.2.0` · rules `setup-engine-v1` (history: `KLYNGE_RULE_HISTORY`) · entry point `evaluateSetup()` in `src/klynge/triggers/setup-engine.ts`.

## Constitution
- **Regime is permission to continue analysis, never a setup.** RISK_ON ≠ CALL_SETUP and RISK_OFF ≠ PUT_SETUP.
- TOUCH ≠ BREAK ≠ ACCEPTANCE ≠ RETEST ≠ CONFIRMATION ≠ guaranteed success.
- No agent, UI, adapter or preference can bypass an upstream deterministic blocker.

## Pipeline
```
MarketTruthSnapshot ─ gate: isDirectionallyEligible(permission) AND isDirectionallyEligible(evaluateTradePermission(regime, dq))
                      AND provenance.evaluatedAt === now
target session ───── buildTechnicalState (data quality first) · same timeframe as market · |target.ts − regime.ts| ≤ skew
prior session ────── assessSessionQuality(now = prior.close), same symbol/timeframe, closes before target opens
target direction ─── RISK_ON needs BULLISH, RISK_OFF needs BEARISH. Opposite ⇒ BLOCKED (conflict). NEUTRAL ⇒ WAIT.
levels (as-of) ───── for every candle i: discoverLevels(asOfIndex = i−1)   (no lookahead)
price action ─────── runPriceAction per tradable level → lifecycles
confirmation ─────── evaluateConfirmation (all-mandatory)
risk ─────────────── evaluateRisk
decision ─────────── CALL_SETUP | PUT_SETUP | WAIT | BLOCKED | INVALIDATED (+ validateDecisionState invariant)
```

## Levels (`levels/`)
| Type | Source | Confirmed | Strength |
|---|---|---|---|
| PRIOR_SESSION_HIGH / LOW | prior session extremes | yes, at prior close | VALID |
| SESSION_HIGH / LOW | running extremes up to as-of | no (dynamic) | WEAK |
| SWING_HIGH / LOW | each confirmed swing (lookback 2) | yes, at confirmation candle | WEAK |
| RESISTANCE / SUPPORT | clusters of ≥ `minimumTouches` same-side swings | yes, when the Nth member confirms | VALID (= N), STRONG (> N) |
| VWAP | session VWAP | no (dynamic) | WEAK |

- **Clustering.** `tol = atrToleranceMultiplier × ATR14(as-of)`. Swings are sorted by price; a swing joins the open cluster while `price − cluster.min ≤ 2·tol`. The cluster price is the mean of its members.
- **ID.** `SYMBOL:TF:TYPE:PRICE(≤4dp):CREATED_AT`. It is deterministic and contains no UUIDs.
- **Tradable break levels.** A level must be confirmed and not WEAK:
  - bullish: RESISTANCE or PRIOR_SESSION_HIGH
  - bearish: SUPPORT or PRIOR_SESSION_LOW
  - A new lifecycle may only start while the level is in the as-of set.

## Price action (`price-action/`)
Signed favorable distance is `s(x) = d·(x − L)`, with d = +1 for bullish and −1 for bearish. ATR is taken at each candle (`atrSeries`).

| From | Rule | To |
|---|---|---|
| WAITING/TESTING | armed (a close ≤ level since the last lifecycle) and `s(close) ≥ minimumCloseDistanceAtr·ATR` | BROKEN (new lifecycle) |
| WAITING/TESTING | `s(high/low) ≥ −touchTol` | TESTING, else WAITING |
| BROKEN | `s(close) ≤ −maximumFailureDistanceAtr·ATR` | FAILED |
| BROKEN | `s(close) > 0` counts toward acceptance (the break candle is excluded). A non-material close back resets the count. `requiredCloses` consecutive closes ⇒ | ACCEPTED |
| ACCEPTED | material close back | FAILED (failed retest) |
| ACCEPTED | adverse extreme within `retest.toleranceAtr·ATR`; deeper than `maximumDepthAtr·ATR` ⇒ FAILED | RETESTING |
| RETESTING | material close back or too deep | FAILED |
| RETESTING | `s(close) > 0` and close beyond the previous candle's favorable extreme | CONFIRMED |
| CONFIRMED | close beyond invalidation | INVALIDATED |
| FAILED/INVALIDATED | re-armed + fresh break | WAITING → BROKEN (new lifecycle) |

- Legal transitions are enforced in `LEGAL_TRANSITIONS`. `assertTransition` throws on anything else (for example WAITING→CONFIRMED, BROKEN→CONFIRMED, FAILED→CONFIRMED, INVALIDATED→CONFIRMED).
- Invalidation is fixed at confirmation: `min(L, retestExtreme) − invalidationToleranceAtr·ATR` for bullish, mirrored for bearish.
- When several lifecycles exist, the decision uses the one with the most recent `startedAt`. Ties go to the higher level (bullish) or lower level (bearish), then to the id.

## Confirmation (`confirmation/`)
CONFIRMED requires **all** of the following. There is no weighting or voting.
- market permission
- target aligned
- valid level
- break, acceptance and retest
- continuation close
- no invalidation

RETESTING without the rest is PARTIAL, FAILED/INVALIDATED is FAILED, and everything else is PENDING.
Volume grades quality only. Continuation-candle relative volume ≥ 1.2 gives HIGH; otherwise (including unknown volume) STANDARD. Volume never blocks a structurally valid setup.

## Risk (`risk/`)
- `entryZone` (bullish) = `[L, L + entryToleranceAtr·ATR]`, mirrored for bearish. Entry is the zone midpoint.
- `stop = |entry − invalidation|`. The invalidation must lie beyond the zone, otherwise `NO_INVALIDATION`.
- `target` = the nearest **confirmed, unbroken** level beyond the zone edge. "Broken" means some close went through it after it became known. The setup level is excluded. No such level gives `NO_TARGET`.
- `R:R = |target − entry| / stop`. Below `minimumRewardRiskRatio` gives `INSUFFICIENT_REWARD_RISK`.
- `stop/ATR > maximumStopAtr` gives `STOP_TOO_WIDE`. Current price beyond the zone edge by more than `maximumExtensionAtr·ATR` gives `PRICE_EXTENDED`.
- Risk level is set by `f = stopAtr / maximumStopAtr`: ≤⅓ LOW, ≤⅔ MODERATE, ≤0.85 ELEVATED, otherwise HIGH. Blocked results are BLOCKED.

Defaults:

| Setting | Default |
|---|---|
| minimumTouches | 2 |
| atrTolerance | 0.25 |
| break | 0.1 |
| acceptance | 2 closes, failure 0.25 |
| retest | 0.25, depth 0.5 |
| minimum R:R | 2.0 |
| maximum stop | 1.5 ATR |
| entry | 0.25 |
| invalidation | 0.25 |
| extension | 1.0 |

## Decisions
| Decision | When |
|---|---|
| CALL_SETUP / PUT_SETUP | Every stage true, risk allowed, and `validateDecisionState` passes (otherwise the engine throws). |
| WAIT | The setup is legitimately forming: no test, break pending, acceptance pending, retest pending, confirmation pending, or target NEUTRAL. |
| BLOCKED | Market permission blocked, target/regime conflict, bad target or prior data, timeframe mismatch, skew, or risk rejected. |
| INVALIDATED | The lifecycle FAILED or INVALIDATED; or an *active* previous lifecycle lost an upstream gate (regime change, regime flip, target conflict, or data failure); or the previous decision already invalidated this exact `setupId`. |

- `previous` is used only to end lifecycles. It can never enable one.
- Every state carries `progress`, `reasons`, `blockers`, `invalidationReasons` and `explanation`: summary, missing stages, what invalidates it, and risk blockers.

## Determinism & governance
- Everything is pure, with an explicit `now`. Outputs are deep-frozen and inputs are never mutated.
- `checkAgentSetupClaim` rejects agent claims that differ from the engine (decision, price-action state, confirmation or risk). It also rejects any directional state that fails `validateDecisionState`.

## Known gaps (v1)
- Resolved in `mtf-options-v1`: multi-timeframe context and multi-session warm-up (see `multi-timeframe.md`). The target timeframe must still equal the market-context timeframe, which the pipeline guarantees by deriving both from the SETUP role.
- A terminal lifecycle stays the decision until a fresh break creates a new one. This is conservative: a fresh level forming meanwhile still reports INVALIDATED.
- The engine keeps no state between evaluations. Ending a lifecycle on a context change depends on the caller passing `previous`. Replay does this automatically; live use still needs persistence (Batches 31–40).
