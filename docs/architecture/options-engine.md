# Options Eligibility Engine (INTERNAL)

> INTERNAL. Never link from or paraphrase on public surfaces.

Source: `src/klynge/options/`. **NO UNDERLYING SETUP = NO OPTIONS ELIGIBILITY.**

## Authority
`evaluateSetup` → CALL_SETUP / PUT_SETUP only → `evaluateOptions` → ELIGIBLE / WAIT / BLOCKED.

- The option type is **derived** from the underlying: CALL_SETUP ⇒ CALL only, PUT_SETUP ⇒ PUT only. The chain is never scanned to pick direction.
- If the underlying is WAIT, the options decision is WAIT. If it is BLOCKED or INVALIDATED, the options decision is BLOCKED. In both cases nothing is evaluated and every contract is rejected with `NO_UNDERLYING_SETUP`.
- A forged directional state fails `validateDecisionState` and gives `INVALID_UNDERLYING_DECISION`.
- A poor chain gives an options decision of BLOCKED (`NO_ELIGIBLE_CONTRACTS`). **The underlying setup is never modified or invalidated.**
- ESLint layering forbids every core engine layer from importing `options/`, `replay/`, `pipeline/` or `agents/`.

## Chain-level vetoes
- Underlying mismatch.
- Snapshot after `now` (`FUTURE_QUOTE`).
- Snapshot older than `maximumQuoteAgeMs` (`STALE_CHAIN`).
- Invalid underlying price.

## Per-contract evaluation (`contract-evaluation.ts`): every rule is a veto
- **Quote and data checks:**
  - `WRONG_OPTION_DIRECTION`, `UNDERLYING_MISMATCH`
  - `INVALID_QUOTE`: non-finite or negative fields, zero ask, strike ≤ 0, or a delta sign inconsistent with the type
  - `ZERO_BID`, `CROSSED_MARKET`
  - `FUTURE_QUOTE`, `STALE_QUOTE` (> `maximumQuoteAgeMs`), `EXPIRED`
- **Policy filters:**
  - `OUTSIDE_DTE_RANGE` (inclusive bounds)
  - `SPREAD_TOO_WIDE` (spread% > max)
  - `INSUFFICIENT_VOLUME`, `INSUFFICIENT_OPEN_INTEREST`
  - `DELTA_UNAVAILABLE` / `OUTSIDE_DELTA_RANGE` (uses |delta|)
  - `PREMIUM_EXCEEDS_POLICY`, `POOR_LIQUIDITY`
- **Metrics** (`metrics.ts`):

  | Metric | Definition |
  |---|---|
  | DTE | `(expiration − now)/day` |
  | mid | `(bid+ask)/2` |
  | spread | `ask − bid` |
  | spread% | `spread·100/mid` (exact at boundaries) |
  | moneyness% | CALL `(S−K)/S`, PUT `(K−S)/S` (positive = ITM) |
  | premium | `ask × multiplier` (buy at ask, conservative) |
  | breakeven | CALL `K + ask`, PUT `K − ask` |
  | capital at risk | premium. "Maximum capital at risk may equal 100% of premium paid." |
- **Liquidity** (transparent, no score):

  | State | Rule |
  |---|---|
  | GOOD | spread% ≤ max/2, volume ≥ 2·min, OI ≥ 2·min |
  | MARGINAL | meets every minimum |
  | POOR | below any minimum |
- **Risk state:** any blocker ⇒ BLOCKED; otherwise GOOD ⇒ ELIGIBLE and MARGINAL ⇒ CAUTION. Both ELIGIBLE and CAUTION appear in `eligibleContracts`.

## Ordering (`compareCandidates`)
This is an ordering, never a "best" pick. Candidates are sorted by:
1. liquidity, GOOD before MARGINAL
2. lower spread%
3. DTE closest to `(min+max)/2`
4. |delta| closest to the delta-range midpoint, when both bounds are set
5. lower premium
6. symbol

## Provisional defaults (`policy.ts`, not production-calibrated)
| Setting | Default |
|---|---|
| DTE | 7–45 |
| Open interest | ≥ 500 |
| Volume | ≥ 100 |
| Spread | ≤ 10% |
| \|delta\| | 0.30–0.70 |
| Quote age | ≤ 60s |
| Multiplier | 100 |
| Premium cap | none |

Every result carries `riskNotice`: "Klynge is not financial advice. Options involve substantial risk and may expire worthless. A long option position may lose 100% of the premium paid."
