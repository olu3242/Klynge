# Klynge runbooks

Deterministic, operator-facing procedures. Every incident on `/app/ops` links one of these sections.

| Runbook | Covers |
| --- | --- |
| [incident-response.md](incident-response.md) | Severity, first response, communication, closure |
| [migrations.md](migrations.md) | Applying, verifying and rolling back Supabase migrations |
| [provider-outage.md](provider-outage.md) | Provider down or degraded, missing SPX/MNQ feed |
| [stale-data.md](stale-data.md) | Stale sessions, historical-ingestion failures |
| [runtime-recovery.md](runtime-recovery.md) | Corrupted runtime cursors, duplicate processing, restarts |
| [notification-worker.md](notification-worker.md) | Dead letters, backlog, lease contention |

Rules that hold in every procedure:

- Fail closed. A missing, stale or unlicensed feed makes evaluations BLOCKED. Never "fix" it by substituting
  another instrument (NQ for MNQ, SPY for SPX), by filling candles, or by relaxing a threshold.
- Do not edit decision records, alerts, journal entries, verdicts or audit rows. They are append-only by design.
- Do not use the service role for anything outside `SERVICE_ROLE_OPERATIONS` (`src/server/admin/service-role.ts`).
- Do not paste keys, JWTs, emails or user content into tickets or chat. Use counts and incident codes.
