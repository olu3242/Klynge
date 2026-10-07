# Public / Product / Internal Boundary (INTERNAL)

Enforced automatically by `scripts/checks/public-boundary.mjs` (part of `npm run lint`).

| Tier | Where | Allowed |
|---|---|---|
| **PUBLIC** | `index.html`, `styles/`, `js/`, `public/` → `dist/` | Product value, high-level workflow, illustrative screenshots, personas, generic states (favorable / cautious / mixed / WAIT / BLOCKED / CONDITIONS MET / INVALIDATED / elevated risk), risk philosophy, brand, disclosures |
| **PRODUCT** | Authenticated app (future) | Instrument analysis, detailed market states, setup progression, risk context, explainability (reasons and blockers in plain language) |
| **INTERNAL** | `src/klynge/`, `docs/architecture/`, `docs/policies/`, tests | Formulas, thresholds, indicator logic, state machines, options-selection rules, agent prompts, orchestration, backtest logic, deterministic rule source |

Rules:
1. Never put internal content on public pages, even paraphrased. This covers:
   - indicator names, thresholds, the instruments used for regime, the skew policy, permission internals
   - level clustering, ATR tolerances, break thresholds, acceptance closes, retest tolerance, minimum R:R
   - the stop/entry algorithm, target selection and state transitions
2. `dist/` is built from an allowlist (`scripts/build.mjs`). Engine source is compiled to `build/engine/` and is never shipped to the public site.
3. Public pages never link to `docs/` or `src/`.
4. Banned marketing language includes: guaranteed, safe trade, can't miss, buy now, sell now, guaranteed profit, sure win, beat the market, never lose.
5. Required on the landing page: the compact disclosure (hero and footer) and the full disclosure (Risk section).
