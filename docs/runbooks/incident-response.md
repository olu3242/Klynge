# Incident response

## Severity

- **CRITICAL** on `/app/ops` (PROVIDER_DOWN, MISSING_FEED, CORRUPTED_RUNTIME, DUPLICATE_PROCESSING) means users may
  see BLOCKED evaluations, or records need investigation. Respond within the pilot's support window.
- **WARNING** (STALE_SESSION, DEAD_LETTER, DELIVERY_BACKLOG, LEASE_CONTENTION, INGESTION_FAILURE) is degraded
  service. Klynge's guarantees still hold.

## First response

1. Open `/app/ops` and record the status, the incident codes, their counts, `generatedAt` and the engine and rule
   versions.
2. Follow the linked runbook section. Each one is deterministic and safe to repeat.
3. If the cause is a deployment, roll back the app with the release procedure. Roll back the schema only through
   [migrations.md](migrations.md).

## Communication

Pilot users see failures as WAIT/BLOCKED with plain reasons. Never promise a time for "signals to return". Klynge
issues no signals.

## Closure

An incident is closed when `/app/ops` no longer lists it, together with a short note of the root cause and the
runbook used. Record counts only, never user data.
