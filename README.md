# Klynge — Market Risk Intelligence

Risk-first market decision-support platform. This repository contains:

- **Public landing**: `index.html`, `styles/`, `js/`, and assets in `public/`. Static, with zero runtime dependencies.
- **Brand system**: canonical tokens in `src/brand/tokens.json`. A deterministic generator produces the logo, wordmark, icon, favicon, social, palette, brand kit and zip (`public/brand/asset-manifest.json`).
- **Deterministic engine** (internal, `src/klynge/`):
  - Market truth: data quality → indicators → structure → technical state → SPX/MNQ regime (with an optional SPY/ES volume proxy) → trade permission.
  - Setup engine: levels → break → acceptance → retest → confirmation → risk → CALL_SETUP / PUT_SETUP / WAIT / BLOCKED / INVALIDATED.
  - Multi-timeframe context: macro/structure bias gate and execution context, derived from one base feed.
  - Replay with no-lookahead guards, plus report-only calibration.
  - Options eligibility, strictly downstream of the underlying setup.
  - Visual intake: chart observations with per-field provenance → visual context (WAIT/BLOCKED only); DATA mode required for setups.
- **Product app** (`apps/web`, Next.js): Supabase Auth (Google OAuth + email magic link) with an anonymous visual trial;
  upload charts, review what was observed / not verified / missing, confirm fields, connect verified market data
  (VISUAL → DATA handoff), import OHLCV, journal, history and in-app alerts, persisted under RLS.
  See `docs/architecture/visual-intake.md` and `docs/architecture/auth-live-data.md`.

## Commands
```bash
npm install
npm run dev        # build + serve dist/ on http://localhost:3000
npm test           # engine tests (node:test)
npm run typecheck
npm run lint       # ESLint + public IP-boundary scan + brand drift check
npm run build      # site -> dist/, engine -> build/engine/
npm run qa         # Playwright landing QA (responsive, a11y, links, console)
npm run brand      # regenerate brand assets from tokens
npm run check      # everything
```
App: `cd apps/web && npm install && cp .env.example .env.local && npm run dev` (http://localhost:3100); `npm run check:app` from the root runs every app gate.
Requires Node ≥ 22.18. QA and brand rendering use a Chromium at `/opt/pw-browsers` (override with `CHROMIUM_PATH`).

## Deploy
Publish `dist/` only (any static host). It is built from an allowlist and never contains engine source.

## Placeholders to wire up
Sign In and Get Started currently anchor to `#get-started` until the authenticated app exists.
`og:image` is relative; make it absolute once the production domain is set.

## Compliance
Klynge is not financial advice. Trading involves substantial risk and you may lose 100% of the capital committed to a trade.
See `docs/COPY_AND_DISCLOSURE.md`.
