# Production readiness (INTERNAL) — `production-calibration-v1`, engine 0.6.0

## Session security (apps/web)
- CSRF: middleware rejects state-changing requests whose `Origin` (or `Sec-Fetch-Site`) is not this site (403).
  `KLYNGE_SITE_URL` is authoritative behind proxies.
- Headers: CSP (`default-src 'self'`, `frame-ancestors 'none'`, `form-action` limited to self + Supabase Auth + Google),
  X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, COOP, HSTS.
- Sessions: Supabase (httpOnly cookies, middleware refresh, `getUser()` verification, **global** sign-out revoking
  refresh tokens). Mock (test mode only): HMAC-signed, expiring, single-use codes/links, revocable session ids.
- Test machinery (mock auth/email, test clock, provider scenarios) is refused when `VERCEL_ENV`/`KLYNGE_DEPLOYMENT` is
  production, and in production builds unless the e2e harness sets `KLYNGE_E2E_RUN=1`.

## Market data
- `PolygonProvider` (Polygon/Massive aggregates REST; Bearer key; pagination pinned to the configured host; 429/401/403/
  404/5xx mapped to fail-closed codes; raw payloads kept for ingestion; index bars without volume flagged).
- `ResilientProvider`: client token bucket, bounded retries with exponential backoff honouring Retry-After, no retries
  for entitlement/mapping errors, health (`HEALTHY/DEGRADED/DOWN`).
- `RoutedProvider`: per-symbol entitlements + equity pass-through; `FORBIDDEN_SUBSTITUTIONS` (SPX ↛ SPY/ES…, MNQ ↛ NQ/QQQ…).
- **MNQ is not licensed by the Polygon adapter** → DATA mode BLOCKED (`ENTITLEMENT_MISSING`) until a CME futures adapter
  (e.g. CME Globex via a licensed vendor) is added. This is deliberate: no NQ/MNQ substitution.

## Exchange calendars (`src/klynge/calendar/`)
- Explicit US DST rule (no host tz data). NYSE RTH 09:30–16:00 ET, 13:00 early closes, holiday table 2025–2027
  (configuration — re-verify annually). CME equity-index futures: D−1 18:00 → D 17:00 ET, daily halt, Sunday open.
- Fail closed: outside coverage ⇒ `OUTSIDE_COVERAGE`; NYSE holidays ⇒ `EXCLUDED`; CME holiday/early-close/post-holiday
  sessions are **excluded rather than guessed**. Bars inside excluded sessions are dropped with a warning; any other
  off-session bar fails normalization. Runtime: closed market ⇒ WAIT (`MARKET_CLOSED`), excluded/uncovered ⇒ BLOCKED.

## Historical data (`src/klynge/history/`, `apps/web/src/server/history/`)
Raw vendor payloads, normalized sessions and manifests are stored separately; manifests carry SHA-256 of both,
provider/symbol/interval/range/acquisition time, issues (missing bars/sessions, duplicates, out-of-order, off-session,
corrections) and the license (retention, no redistribution). Re-ingestion never overwrites; corrections create new
datasets. `retentionSweep` purges raw records only. Replay from stored data is byte-identical.

## Calibration (`src/klynge/calibration/`)
`sensitivitySweep` varies one parameter around the production default and reports WAIT/BLOCKED/setup/invalidated
rates, entries, outcomes and blocker frequency (regime, MTF, data quality…). Reports are hashed and labelled
SYNTHETIC/EMPIRICAL. `proposePolicyChange` refuses synthetic evidence; `approvePolicyChange` requires a named human and
a new rule version; defaults remain frozen until a release ships the change.

## Backtesting (`src/klynge/backtest/`)
Event-driven, hypothetical: next-bar-open fills with half-spread + slippage, per-share commission, stop-before-target
on ambiguous bars, gap-through fills at the open, INVALIDATED exits at the next open, time stop, flat at session end.
Day-by-day replay (no lookahead); chronological TRAIN/VALIDATION/OUT_OF_SAMPLE partitions; expectancy (R), drawdown,
R realization, exits, WAIT/BLOCKED time, by regime/ticker/timeframe; deterministic bootstrap CI; `insufficientSample`
below 30 trades; `performanceClaim: "NONE"`.

## User risk policies (`src/klynge/user-policy/`)
Max hypothetical exposure / loss tolerance, allowed instruments, session preference, options-risk acknowledgement.
`applyUserPolicy` returns the engine decision verbatim plus vetoes; stored as `klynge_policy_verdicts` (append-only),
separate from `klynge_decisions`. No broker execution.

## Notifications + monitoring
Outbox per (alert, channel), opt-in by event/severity, verified-address only, dedupe window, hourly cap (defer, not
drop), retries with backoff, dead letter after 5 attempts, audit entries. Adapters: Resend (HTTP) and mock.
`/app/status`: provider health + licensed instruments, data freshness, 24 h provider failures, delivery counts, audit.
`/api/health` exposes liveness only. `/api/cron/notifications` (Bearer secret) retries in-process outboxes.

## Persistence
Migration `0002_klynge_account.sql`: user policies, policy verdicts, notification prefs + outbox, audit log — owner-only
RLS, append-only verdicts/audit, notification address pinned to the caller's JWT email. Certified locally
(`npm run test:rls`); hosted certification requires an approved migration (`npm run rls:hosted -- --confirm`).
