# Stale data

## Stale sessions

Symptom: STALE_SESSION. Runtime cursors have not advanced for more than 20 minutes while the market is open.

1. Check provider health first ([provider-outage.md](provider-outage.md)).
2. Check whether the user's data connection is still active. Stale is expected when nobody is evaluating.
3. Never backfill a decision. The next verified evaluation sees the gap and decides on current data only.

## Ingestion

Symptom: INGESTION_FAILURE. Historical datasets are unclean (missing bars, duplicates, outside-session bars)
or fail hash verification.

1. `node --conditions=react-server scripts/history-ingest.ts …` again for the same range. Identical content
   keeps its id. Vendor corrections create a new version that supersedes the old one, which is never overwritten.
2. A hash mismatch means tampering or corruption. Quarantine the directory and re-ingest from the vendor.
3. Unclean datasets are excluded from calibration (`scripts/calibrate.ts` uses clean HISTORICAL manifests only).
   Never fill gaps.
