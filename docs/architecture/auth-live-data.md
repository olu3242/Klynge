# Authentication, ownership and live data (INTERNAL) — `auth-live-data-v1`, engine 0.5.0

```
USER ──┬── chart upload ─────────────▶ VISUAL MODE (observations; WAIT/BLOCKED only)
       └── connected market data ────▶ DATA MODE   (normalize → validate → engine)
                     │
              AUTHENTICATED USER  (Supabase Auth: Google OAuth, email magic link)
                     │
              TENANT-OWNED SESSION  (tenant_id = auth.uid(), RLS)
                     │
                KLYNGE ENGINE ──▶ PERSISTED DECISION ──▶ JOURNAL / ALERTS
```

## Constitution
`NO VERIFIED USER → NO DURABLE USER-OWNED MARKET SESSION` · `SERVICE ROLE ≠ USER AUTHORIZATION` · `VISUAL ≠ DATA` ·
`OPTIONS NEVER CREATE A SETUP`.

## Identity (`apps/web/src/server/identity.ts`, `auth/*`)
- `AuthGateway`: `SupabaseAuthGateway` (anon key + @supabase/ssr cookies, PKCE; `getUser()` revalidates with the Auth
  server) or `MockAuthGateway` (HMAC-signed, expiring, single-use codes/links; **test mode only**).
- `resolveIdentity` → `USER { tenantId = auth user id }` or `TRIAL { tenantId = "trial:<random cookie>" }`.
  Ownership never comes from bodies, query strings or the legacy `klynge_tenant` cookie (ignored and cleared).
- Routes: `/sign-in`, `POST /auth/oauth/google`, `POST /auth/magic-link`, `GET /auth/callback` (code exchange),
  `GET /auth/confirm` (magic link), `POST /auth/sign-out`. Redirect targets are same-origin relative paths only
  (`safeNext`); set `KLYNGE_SITE_URL` in production and add it to Supabase's redirect allow-list.
- Session refresh: middleware runs `supabase.auth.getUser()` and writes rotated cookies. Protected pages
  (`/app/history`) and durable APIs check the verified identity server-side (401 / redirect to sign-in).

## Anonymous trial
`TrialSessionStore`: in-memory, 2 h TTL, 5 000-session cap, VISUAL records only; refuses journal, alerts, runtime state
and DATA decisions. Promotion (`POST /api/session/promote {accept:true}`) copies the trial into a new durable session
with `origin = ANONYMOUS_TRIAL`; "Not now" just hides the prompt. The trial is never mutated.

## Persistence + RLS (`apps/web/supabase/migrations/0001_klynge_sessions.sql`)
Tables: `klynge_sessions`, `klynge_decisions`, `klynge_alerts`, `klynge_journal`, `klynge_runtime_state`; `tenant_id uuid`
references `auth.users` (cascade on account deletion).
- anon: no privileges. authenticated: sessions CRUD own; decisions/alerts/journal select + insert own; runtime state
  select/insert/update own. Every policy is `tenant_id = (select auth.uid())`.
- Append-only triggers on decisions, alerts and journal (no update for any role). No delete policies for those tables.
- Checks: payload owner = `tenant_id`; VISUAL rows cannot hold a DATA decision or a non-WAIT/BLOCKED permission; DATA
  rows carry DATA decisions; journal FK `(tenant_id, record_id)` → own decisions only.
- Certification: `npm run test:rls` boots a local PostgreSQL with a Supabase `auth` emulation and proves own-user CRUD,
  cross-user read/update/insert denial, anonymous denial, append-only enforcement, VISUAL non-directionality and
  journal/alert/runtime ownership. `npm run rls:hosted -- --confirm` runs the same matrix through PostgREST with real
  user JWTs after a deliberate migration (service role used only for allow-listed schema/test-user operations).

## Providers (`src/klynge/providers/`)
`MarketDataProvider { getHistoricalCandles, getLatestCandles }`, optional `LiveMarketDataProvider.subscribe`. Adapters
return provider-symbol candles; the `SymbolMap` layer maps canonical ↔ vendor symbols. `normalizeFeed` validates
mapping, OHLC integrity, ordering, duplicates, session boundaries/grid, completeness and staleness, drops only the
still-forming bar, strips vendor fields and emits `MarketDataProvenance`. `assembleFeeds` requires TARGET+SPX+MNQ on
one market clock (volume proxy optional). Failures → `WAIT` (rate limit) / `BLOCKED` (everything else).
Mocks: `MockHistoricalProvider`, `MockLiveProvider`, `FailingProvider`, `StaleProvider`, `MalformedProvider`.
Provisional policy: `maxStalenessMs 60 s`, `maxFeedSkewMs 0`.

## DATA runtime (`src/klynge/runtime/`)
`runDataCycle`: restore cursor → fetch → normalize → assemble → (idempotency) → snapshot → MTF pipeline (market truth,
setup, risk) → options (downstream; empty chain ⇒ nothing eligible) → persist → alerts → cursor.
- Previous decision: loaded from the store automatically (latest DATA decision for the symbol).
- Keys: record id = `session:DATA:symbol:latestBar:fnv(market state)`; alerts carry deterministic ids; provider
  failure alerts key on the last processed market timestamp; live events dedupe on `eventId`.
- Recovery: state referencing a missing decision, a cursor/record mismatch, a symbol mismatch or an unreadable store ⇒
  `RUNTIME_STATE_UNAVAILABLE` (BLOCKED). Older data than the cursor ⇒ `OUT_OF_ORDER` (BLOCKED).
- `LiveDataRuntime` serializes cycles per event; events are re-evaluation triggers, bars are always re-read.

## VISUAL → DATA handoff (`src/klynge/snapshot/handoff.ts`)
`DataHandoff { fromSessionId, fromEvidenceMode, symbolHint, timeframeHint, intent, createdAt }` — no prices, VWAP/EMA,
ATR, volume baselines, levels, R:R or visual decisions. DATA decisions are identical with or without a handoff (tested).
The UI shows the evidence mode at all times and announces "VISUAL ANALYSIS → DATA VERIFIED".

## Alerts
Events: VISUAL_CONTEXT_COMPLETE/INCOMPLETE, DATA_VERIFIED, RISK_ON, RISK_OFF, MIXED, SETUP_WAIT, CALL_SETUP, PUT_SETUP,
BLOCKED, INVALIDATED, OPTIONS_ELIGIBLE, OPTIONS_BLOCKED, PROVIDER_FAILURE. In-app only; derived from state changes.

## Known gaps
No real vendor adapter yet (interface + env slot only); fixed-period calendar only (no DST/holiday calendar); hosted
migration + hosted RLS certification not yet run; Supabase Auth providers (Google client, SMTP) must be configured in
the Supabase dashboard; the shared memory/file stores are dev/e2e only.
