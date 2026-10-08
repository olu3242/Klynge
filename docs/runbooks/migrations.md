# Migrations

Hosted migrations are **never** applied automatically. Each one needs explicit approval for the named project.

## Before applying

1. `npm run test:rls` (local PostgreSQL). It runs every migration, every rollback (up → down → up must give an
   identical schema), isolation, escalation and worker tests.
2. `npm run readiness:hosted` with the target environment loaded. It checks the shape of the configuration
   without printing any values.
3. Export the affected tables (Supabase dashboard → Database → Backups, or `pg_dump --data-only -t ...`).
4. Get explicit approval naming the project ref and the migration files.

## Applying

Apply in order (`0001`, `0002`, `0003`, …) with `supabase db push` or the SQL editor. Each file is idempotent
(`if not exists`, `drop … if exists`).

## Verification

`npm run rls:hosted` certifies with two dedicated test users: isolation, anonymous denial, append-only and
recipient restrictions. Report hosted results separately from local ones.

## Rollback

Run `supabase/rollback/<migration>.down.sql` in **reverse** order, only after the export above. Rollbacks 0001
and 0002 are destructive. Rollback 0003 keeps outbox rows and only drops the worker functions, the worker run log
and the lease columns.
