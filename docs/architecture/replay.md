# Replay, No-Lookahead & Calibration (INTERNAL)

> INTERNAL. Never link from or paraphrase on public surfaces.

Source: `src/klynge/replay/`.

## Replay (`replay-engine.ts`)
- **Clock.** The frame clock is each base-candle close of the replayed (last) target session. It must strictly increase, otherwise RangeError.
- **Frame at T.** `feedAsOf(feed, T)` keeps only sessions opened before T and candles with `open + tf ≤ T`. The result goes through `evaluateMultiTimeframeSetup(now = T, previous = frame T−1)`. Options use the latest chain snapshot with `timestamp ≤ T`.
- **Chaining.** Passing `previous` closes the "no lifecycle memory" gap during replay: lifecycles end exactly as they would live.
- Frames are deep-frozen, and `replayFrameAt(input, T, previous)` reproduces any single frame.

## No-lookahead certification (`as-of.ts`)
- `assertAsOf(T, sourceTimestamps)` throws `LookaheadViolation`. It runs on every replay input (candle close times).
- `assertFrameAsOf(frame)` checks every timestamp the frame depends on:
  - market truth, technical states, decision, transitions
  - level created/confirmed/last-tested times, lifecycle start
  - MTF role closes, options decision, chain and quote timestamps
- Structural guarantees:
  - swings are confirmed only at `index + lookback`
  - levels are discovered as of `i − 1`
  - the resampler only emits closed buckets
  - quotes later than `now` are `FUTURE_QUOTE`
- Tests prove all of the following:
  - perturbing candles at or after T leaves frame T byte-identical
  - a replay of truncated inputs reproduces every earlier frame
  - a resistance first appears only after its confirming candle closes
  - future highs/lows and touches don't change earlier levels
  - a future regime crash doesn't change earlier market truth
  - future chains and quotes are never used

## Outcomes (`outcomes.ts`): evaluation only
- **Entry** is the entry-zone midpoint at the first CALL/PUT frame of a `setupId`.
- **Labelling** scans base bars that open at or after the entry frame:
  - invalidation is checked first, so a bar that hits both counts as an invalidation (conservative)
  - target hit ⇒ R = reward/risk; invalidation ⇒ R = −1; unresolved ⇒ undefined
- MAE and MFE are tracked in price units, along with regime and bias at entry.
- Labelling uses later bars by design and is **never** fed back into decisions.

## Calibration (`calibration.ts`)
- `CalibrationParameters` exposes these experimental knobs: ATR tolerance, minimum R:R, maximum stop ATR, acceptance closes, break distance and retest tolerance. `setupPolicyFromParameters` maps them onto the canonical policy.
- `runCalibration(datasets, variants)` produces a comparative per-variant report covering:
  - decision counts (WAIT, BLOCKED, INVALIDATED, CALL_SETUP, PUT_SETUP)
  - setups, entered, targets, invalidations, unresolved
  - average MAE, MFE, R and duration
  - entries by regime and by bias
- Purpose: validate deterministic behavior and consistency, **not** maximize profit.
- `productionDefaultsChanged` is always `false`, and the disclaimer states SYNTHETIC versus HISTORICAL.
- **Blocker for real calibration:** the repo contains no historical market data. Only synthetic fixtures exist, so no claims about real markets are possible yet.
