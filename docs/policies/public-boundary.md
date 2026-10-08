# Public / Product / Internal Boundary (INTERNAL)

Enforced automatically by `scripts/checks/public-boundary.mjs` (part of `npm run lint`).

| Tier | Where | Allowed |
|---|---|---|
| **PUBLIC** | `index.html`, `styles/`, `js/`, `public/` → `dist/` | Product value, high-level workflow, illustrative screenshots, personas, generic states (favorable / cautious / mixed / WAIT / BLOCKED / CONDITIONS MET / INVALIDATED / elevated risk), risk philosophy, brand, disclosures |
| **PRODUCT** | `apps/web` (server-rendered; engine is server-only) | Instrument analysis, visual context (BULLISH / BEARISH / MIXED / INSUFFICIENT CONTEXT with WAIT / BLOCKED), provenance per field, setup progression (DATA mode only), risk context, explainability (reasons and blockers in plain language) |
| **INTERNAL** | `src/klynge/`, `docs/architecture/`, `docs/policies/`, tests | Formulas, thresholds, indicator logic, state machines, options-selection rules, agent prompts, orchestration, backtest logic, deterministic rule source |

Rules:
1. Never put internal content on public pages, even paraphrased. This covers:
   - indicator names, thresholds, the instruments used for regime, the skew policy, permission internals
   - level clustering, ATR tolerances, break thresholds, acceptance closes, retest tolerance, minimum R:R
   - the stop/entry algorithm, target selection and state transitions
   - timeframe roles and conflict rules, replay/backtest and calibration internals, no-lookahead implementation
   - DTE, spread, volume/OI and delta filters, the options ranking formula
2a. The options risk notice must appear in the visible Risk section (not footer-only). The scanner requires it.
2. `dist/` is built from an allowlist (`scripts/build.mjs`). Engine source is compiled to `build/engine/` and is never shipped to the public site.
3. Public pages never link to `docs/` or `src/`.
4. Banned marketing language includes: guaranteed, safe trade, can't miss, buy now, sell now, guaranteed profit, sure win, beat the market, never lose.
5. Required on the landing page: the compact disclosure (hero and footer) and the full disclosure (Risk section).
6. PRODUCT app: engine code, rule versions, policy names, blocker codes, the extraction prompt and secrets must never reach
   browser chunks. `apps/web/scripts/check-client-bundle.mjs` enforces this, and the root scanner runs it whenever
   `apps/web/.next/static` exists. Banned marketing language is also scanned in app client sources.
7. VISUAL results never use CALL SETUP / PUT SETUP / CONDITIONS MET / eligibility language and always show
   "Conditions observed — data verification required" plus the compact risk notice.
8. PRODUCT may show state, reasons, missing conditions, risk level, evidence mode and data provenance (provider, provider
   symbol, latest bar). It may NOT expose threshold formulas, ATR multipliers, R:R internals, state-machine thresholds,
   provider normalization internals, options ranking internals or agent prompts. The root scanner checks app client
   sources for these patterns and the bundle guard checks built chunks (plus service-role names, JWTs and test-only machinery).
