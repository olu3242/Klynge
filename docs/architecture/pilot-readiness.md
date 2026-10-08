# Pilot readiness (INTERNAL): `pilot-readiness-v1`, engine 0.7.0

Decision thresholds and decision logic are **unchanged** from `production-calibration-v1`. This release adds evidence,
operations and certification infrastructure.

## Hosted readiness (61)
- `npm run readiness:hosted` validates the hosted configuration by shape only. It never prints values. It checks the
  project URL and ref, distinct anon and service keys, no secret-like `NEXT_PUBLIC_*`, https site URL, test mode off,
  Supabase store, email and cron secret. It also lists migrations and whether each has a rollback.
- Every migration has `supabase/rollback/<name>.down.sql`. The local suite proves that up → down (reverse order) → up
  reproduces an identical schema, policies, triggers and grants, and that a failing statement leaves no partial schema.
- Escalation tests (local PostgreSQL) cover API roles. They cannot create objects, disable RLS, read `auth.users`,
  drop policies or triggers, gain privileges through a non-owner GRANT, or execute any SECURITY DEFINER function.

## CME / MNQ (63)
- `src/klynge/futures/contracts.ts` handles quarterly codes H/M/U/Z. Expiry is the third Friday at 09:30 ET. The
  deterministic roll is `rollDaysBeforeExpiry` (default 8). `activeContract(root, t)` gives the front contract at the
  evaluation time.
- `src/klynge/futures/aggregate.ts` aggregates 1m bars into CME-session-aligned buckets. It emits only buckets that
  have closed, drops halt bars and leaves empty buckets absent. Aggregating 1m→15m equals 1m→5m→15m.
- `apps/web/src/server/providers/cme-futures.ts` is vendor-neutral. It checks the license before any request,
  requests exactly the front contract, rejects bars for another contract (`INVALID_SYMBOL_MAPPING`) and labels
  provenance (`front contract MNQZ6 (rolls …)`). A root other than the canonical one throws, so NQ cannot stand in
  for MNQ.
- `providers/databento.ts` uses CME Globex `GLBX.MDP3` `ohlcv-1m` (Basic auth, server-only key). Status mapping:
  429 → RATE_LIMITED, 401/403 → ENTITLEMENT_MISSING, 404/422 → INVALID_SYMBOL_MAPPING, malformed → MALFORMED_BARS.
  It is configured with `DATABENTO_API_KEY` + `KLYNGE_DATABENTO_DATASETS=GLBX.MDP3` and is routed alongside Polygon
  (SPX/equities).

## Historical ingestion (64)
- `scripts/history-ingest.ts --provider polygon|databento --symbol … --tf 1m|5m|15m|1h|1d`. Raw payloads,
  normalized sessions and manifests are stored separately. Manifests carry SHA-256 hashes, the license and retention.
- Manifests now record `adjustment` (SPLIT_ADJUSTED, UNADJUSTED or FRONT_CONTRACT), `contract`, `version` and
  `supersedes`. Identical content keeps its id. A vendor correction creates version n+1, which supersedes the old
  version without overwriting it.
- `detectCorporateActions` flags session gaps above 25% (`CORPORATE_ACTION_SUSPECTED`). The flag is non-blocking
  and never auto-adjusts. A gapped range normalizes to nothing (fail closed).

## Empirical evaluation (65–66): `src/klynge/evaluation/`
- `replayDays` runs one replay per trading day, using sessions up to that day only.
- `decisionAnalytics` reports decisions by ticker, timeframe and regime, decision transitions, regime alignment of
  setups, invalidation distance (bars, stop in ATR) and risk-veto codes.
- `sealHoldout` defines chronological train / validation / holdout partitions with a SHA-256 seal.
  `calibrationView` truncates calibration input to before the holdout. `assertNoHoldout` and `outOfSampleReport`
  throw `HoldoutViolation` on a leak.
- `costSensitivity` reruns at 0×/1×/2× of commission, spread and slippage. Costs change outcomes, never which setups
  trade.
- `outOfSampleReport` gives per-partition analytics and stats (sample size, win/loss, expectancy, drawdown, bootstrap
  CI) and underlying outcomes by regime, ticker and timeframe. Options are `NOT_EVALUATED`, significance is
  `NOT_ASSESSED`, `performanceClaim: "NONE"`, and the report has a hash.
- `scripts/calibrate.ts` without `--datasets` runs the harness check (SYNTHETIC). With `--datasets` it uses only
  clean, hash-verified HISTORICAL manifests (latest version). If none exist it reports BLOCKED.

## Notification worker (67): migration `0003`
- `klynge_claim_notifications` (SECURITY DEFINER, service_role only) suppresses rows whose recipient is not the
  tenant's confirmed `auth.users` email. It then claims due rows `FOR UPDATE SKIP LOCKED` with a bounded lease.
- `klynge_complete_notification` is fenced: it succeeds only for the current lease owner of a PENDING row, and
  recipient and identity are immutable. `klynge_notification_context` returns prefs plus delivered-in-window, with no
  addresses. `klynge_worker_runs` holds counts only, and no API role can access it.
- `runNotificationWorker` enforces a per-user hourly cap (defer, never drop), backoff, the `MAX_ATTEMPTS` dead letter,
  suppression when preferences change, and a lease-time budget (releases rows it cannot finish). The provider
  idempotency key is `notificationId` = hash(tenant | alert | channel).
- Hosted: `npm run worker:notifications` (scheduler). In-process stores: `POST /api/cron/notifications`.

## Workspace UX (68)
A persistent risk banner sits on every app page (approved compact and signal-card copy plus the evidence boundary).
It adds to the existing evidence-mode labels, completeness indicators, upload/drag/paste/correction flow, explicit
save consent, provenance, journal, alerts, history and settings.

## Monitoring and recovery (69)
- `/app/ops` and `GET /api/admin/ops` are for operators only (404 for everyone else). They show aggregates only:
  provider health, SPX/MNQ feed licensing, session and runtime counts, delivery metrics, worker runs, ingestion
  health and audit-action counts.
- The `/app/ops` incidents are PROVIDER_DOWN, MISSING_FEED, STALE_SESSION, CORRUPTED_RUNTIME, DUPLICATE_PROCESSING,
  DEAD_LETTER, DELIVERY_BACKLOG, LEASE_CONTENTION and INGESTION_FAILURE. Each one links a runbook section, and a test
  checks every link.
- Deterministic recovery is `POST /api/admin/ops/recover`. It quarantines corrupted runtime cursors only, is audited
  as `ops.recovered` and is idempotent.
- Hosted cross-tenant aggregates never run on a request path. On Supabase the dashboard shows provider health only
  (scope `PROVIDER_ONLY`).

## Certification (70)
See `docs/certification/pilot-readiness-v1.md`.
