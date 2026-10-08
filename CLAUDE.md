# CLAUDE.md — Klynge

Read `AGENTS.md` first; it applies in full.

## Context
- Authority: deterministic engine → agent → user. AI is never a source of market truth or trade signals.
- The engine (`src/klynge/`) is TypeScript run via Node ≥22.18 type stripping. Use `.ts` import extensions, `import type`, and erasable syntax only (no enums or namespaces).
- The landing is static HTML/CSS with a small progressive-enhancement script. There is no framework.
- `apps/web` is the product app (Next.js App Router, TS, Tailwind v4, shadcn-style components). It imports the engine server-only.
- User charts are VISUAL evidence: the extractor is an agent producing OBSERVATIONS; USER_CONFIRMED never becomes DATA_VERIFIED;
  CALL_SETUP/PUT_SETUP and options require DATA mode. See the constitution amendments in `AGENTS.md`.
- NO VERIFIED USER → NO DURABLE USER-OWNED MARKET SESSION. SERVICE ROLE ≠ USER AUTHORIZATION. VISUAL ≠ DATA.
  OPTIONS NEVER CREATE A SETUP. Tenant = auth user id, derived server-side only; anonymous use is a non-persistent trial.
- 0.6.0: user policies only restrict; calibration is report-only (human-approved, versioned changes); no fabricated
  performance; no instrument substitution; calendars and providers fail closed. See `AGENTS.md`.

## Working style
- Make surgical edits. Brand assets are generated, so edit `src/brand/tokens.json` or `scripts/brand/*` and run `npm run brand`. Never hand-edit generated SVG/CSS.
- Before finishing, run `npm run check` (typecheck, lint + boundary scan + brand drift, tests, build, QA) and, for app changes, `npm run check:app`.
- Never call a model or a live market-data provider from tests or CI; never ask for or paste secrets (service-role key, API keys, JWTs) in chat.
- Never apply Supabase migrations to a hosted project without explicit approval; run `npm run test:rls` first.
- Check new public copy against `docs/COPY_AND_DISCLOSURE.md` and `docs/policies/public-boundary.md`.
- Get explicit approval before adding frameworks, trackers or external fonts.
