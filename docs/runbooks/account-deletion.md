# Account deletion (hosted)

Users export their data themselves (`GET /api/account/export`, also available while suspended). On in-process
stores, self-service deletion runs at `/app/settings` → "Your data". On Supabase, decision, alert and journal rows are
append-only for users, so deletion is an operator procedure:

1. Verify the request comes from the account's verified email address. Never act on an unverified address.
2. Offer the export first and record the request date (counts only).
3. Delete the auth user through the Supabase dashboard (Authentication → Users). Every Klynge table references
   `auth.users (id) on delete cascade`, so all of the user's rows are removed.
4. Record a `pilot.completed` (or equivalent) operator audit entry with counts only. Never record the email.
5. Raw vendor datasets contain no user data and are not affected.
