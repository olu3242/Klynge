# Notification worker

Hosted delivery runs as `npm run worker:notifications` from the scheduler. It never runs on a request path. It needs
migration 0003, the allow-listed `notifications.dispatch` service-role operation and a production email provider.

## Dead letters

Symptom: DEAD_LETTER. Rows are FAILED after `MAX_ATTEMPTS` or after a non-retryable provider error.

1. Check the email provider status and the sender domain. Never log recipients.
2. Dead letters are not re-sent automatically. Alerts are informational, and a late email about an old state change
   would mislead.

## Backlog

Symptom: DELIVERY_BACKLOG. Due rows have waited more than 30 minutes. The scheduler is probably not running the
worker. Run it once by hand and check that it prints counts.

## Lease contention

Symptom: LEASE_CONTENTION. A worker's completion was rejected by lease fencing because runs overlapped or one ran
slowly.

- Rows are claimed with `FOR UPDATE SKIP LOCKED`, so overlapping workers never claim the same row.
- A worker that loses its lease cannot overwrite the newer outcome. The provider idempotency key
  (`notificationId`) prevents a second email.
- Lengthen the schedule interval or shrink the batch size. Do not raise the lease above 15 minutes (it is bounded
  in SQL).
