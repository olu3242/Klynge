# Runtime recovery

## Corrupted cursor

Symptom: CORRUPTED_RUNTIME. A runtime cursor points at a missing record, carries an unknown rule version or decision,
or has a future market timestamp.

1. Operators: `POST /api/admin/ops/recover` (or the runbook action on `/app/ops`). This quarantines only the corrupted
   cursors and writes an `ops.recovered` audit event (counts only).
2. The next verified evaluation rebuilds the cursor from verified data. Record ids are deterministic, so nothing is
   duplicated and no decision is rewritten.
3. Hosted: identify the rows with the same checks (`runtimeCorruption` in `src/server/ops/ops-report.ts`) through the
   approved maintenance procedure. Do not edit decision records.

## Duplicate processing

Symptom: DUPLICATE_PROCESSING. There is more than one DATA record for the same runtime and bar.

1. Do not delete records (append-only). Capture the count and engine version.
2. Check for overlapping evaluators. Record ids derive from the market state, so a duplicate means two different
   states for one bar. Treat it as a data-quality incident with the provider.

## Restart

A process restart is safe. Cursors and records are durable, and the first evaluation after a restart reports
"previous decision restored". This is certified in E2E journey 9.
