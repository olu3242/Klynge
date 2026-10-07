# AGENTS.md — Klynge

## Product
Klynge is a **risk-first market decision-support platform**. It rejects bad or insufficiently supported trades
until the market provides enough evidence to justify directional risk. **WAIT and BLOCKED are valid outcomes.**
Klynge is NOT a brokerage, an investment adviser, a guaranteed signal service, or an autonomous trading system.

## Repository map
| Path | Tier | Purpose |
|---|---|---|
| `index.html`, `styles/`, `js/`, `public/` | PUBLIC | Landing page + brand assets → `dist/` |
| `src/brand/tokens.json` | source of truth | Design tokens → `npm run brand` regenerates `styles/tokens.css`, SVG/PNG assets, kit, zip, manifest |
| `src/klynge/` | INTERNAL | Deterministic market-truth engine (`market-truth-v1`) |
| `docs/architecture/`, `docs/policies/` | INTERNAL | Engine spec, public/product/internal boundary |
| `scripts/` | tooling | build, serve, brand pipeline, boundary scan, QA |

## Commands
`npm test` · `npm run typecheck` · `npm run lint` (ESLint + IP-boundary scan + brand drift check) ·
`npm run build` (site → `dist/`, engine → `build/engine/`) · `npm run qa` (Playwright landing QA) · `npm run check` (all).

## Authority hierarchy (absolute)
```
DETERMINISTIC ENGINE  →  AGENT  →  USER
```
Agents **may**: explain, summarize, monitor, coordinate, surface changes.
Agents **may not**:
- fabricate market state or invent market data
- override MIXED or UNKNOWN
- bypass BLOCKED
- change deterministic results

Agent claims are validated with `checkAgentClaim()`. Engine outputs are deep-frozen.

## Canonical agents
| Name | Identifier |
|---|---|
| Klynge Market Agent | `marketAgent` |
| Klynge Context Agent | `contextAgent` |
| Klynge Structure Agent | `structureAgent` |
| Klynge Levels Agent | `levelsAgent` |
| Klynge Confirmation Agent | `confirmationAgent` |
| Klynge Risk Agent | `riskAgent` |
| Klynge Options Agent | `optionsAgent` |
| Klynge Explainability Agent | `explainabilityAgent` |
| Klynge Replay Agent | `replayAgent` |
| Klynge Journal Agent | `journalAgent` |
| Klynge Alert Agent | `alertAgent` |

Defined in `src/klynge/agents/registry.ts`. Do not rename or add agents without updating both.

## Engine rules for contributors and agents
1. `evaluateTradePermission()` is the **only** permission policy. Never re-implement it in UI, agents or later engines.
2. Downstream code gates on `isDirectionallyEligible()`. NO_DATA, STALE_DATA, BAD_DATA, TIMESTAMP_SKEW, INSUFFICIENT_HISTORY, MIXED_REGIME and UNKNOWN_REGIME ⇒ BLOCKED, always.
3. Determinism: no `Date.now()`, `new Date()` or `Math.random()` in `src/`. ESLint enforces this. Pass `now` explicitly.
4. Changing a rule or threshold requires bumping `KLYNGE_RULE_VERSION` and updating `docs/architecture/market-truth-engine.md`.
5. Never weaken a test or a rule to get green checks.
6. Not yet implemented, and must not be faked: levels, break/retest, options selection, brokerage, live alerts, autonomous trading.

## Public page rules
1. No engine internals on public surfaces (see `docs/policies/public-boundary.md`). `npm run lint` fails on leaks.
2. Never remove or weaken disclosures: the hero compact notice, the Risk section full disclosure, and the footer notice.
3. Banned: guaranteed, safe trade, can't miss, buy now, sell now, guaranteed profit, sure win, beat the market, never lose.
4. Preferred vocabulary: CALL SETUP, PUT SETUP, WAIT, BLOCKED, CONDITIONS MET, CONFIRMATION PENDING, INVALIDATED, RISK ELEVATED.
5. Previews are illustrative and must be labeled as such.
6. Accessibility:
   - status is never shown by color alone (glyph + text)
   - focus stays visible
   - landmarks are present
   - reduced motion is respected
7. No third-party scripts, trackers, remote fonts or remote assets.
8. Colors come only from `styles/tokens.css`. Never hard-code new palette values.

## Definition of done (landing)
`npm run qa` passes. It covers:
- widths 1440/1280/1024/768/430/390 with no horizontal overflow
- no console errors, broken links or missing images
- the mobile nav, keyboard focus and FAQ work
- contrast passes
