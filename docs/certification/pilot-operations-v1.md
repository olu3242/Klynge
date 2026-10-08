# Controlled pilot certification: `pilot-operations-v1` (engine 0.8.0)

**LOCALLY CERTIFIED** means offline fixtures, local PostgreSQL and the browser E2E harness with invite-only access
enforced. **HOSTED / LIVE** means a hosted Supabase project or licensed providers. Hosted and live certification run
separately, only when authorized. A blocked environment is never reported as passing.

| # | Journey | Local evidence | Local | Hosted / live |
|---|---|---|---|---|
| 1 | Pilot invitation → sign-in → activation | e2e P1 (operator invite; anonymous → sign-in; uninvited held at /pilot; explicit acknowledgements; audited); `pilot.test.ts`; `rls-pilot.test.ts` | LOCALLY CERTIFIED | BLOCKED (migration 0004 not applied) |
| 2 | Anonymous trial → explicit authenticated save | e2e §4 (open mode; nothing copied before consent) | LOCALLY CERTIFIED | BLOCKED |
| 3 | User chart → visual context → correction | e2e P3 (no directional language; USER_CONFIRMED; onboarding progress) | LOCALLY CERTIFIED | n/a |
| 4 | Verified DATA mode → deterministic evaluation | e2e P4, §7 | LOCALLY CERTIFIED (mock provider) | BLOCKED (no licensed credentials) |
| 5 | WAIT/BLOCKED enforcement | e2e P5, §9; `failure-injection.test.ts` | LOCALLY CERTIFIED | BLOCKED (live) |
| 6 | Risk-policy veto precedence | e2e §10b; `settings-policy.test.ts` | LOCALLY CERTIFIED | BLOCKED |
| 7 | Journal, alerts and session history | e2e P7, §5 | LOCALLY CERTIFIED | BLOCKED |
| 8 | Feedback submission and admin review | e2e P8 (decision unchanged; KLY-1 triage audited); `pilot-ops.test.ts` | LOCALLY CERTIFIED | BLOCKED (hosted triage via `pilot:admin`) |
| 9 | Cross-user and cross-role isolation | e2e P9, §8, J12; `rls-pilot.test.ts`; `security-audit.test.ts` | LOCALLY CERTIFIED | BLOCKED (`rls:hosted`) |
| 10 | Provider failure and runtime recovery | e2e P10, §9–§10; `failure-injection.test.ts` | LOCALLY CERTIFIED | BLOCKED |
| 11 | Account-data privacy controls | e2e P11 (own-only export; typed deletion); `pilot-ops.test.ts` | LOCALLY CERTIFIED | PARTIAL: hosted export works under RLS; hosted deletion is an operator procedure (KLY-SEC-002) |
| 12 | Pilot suspension and access denial | e2e P12 (held at /pilot, 403, export still allowed, audited) | LOCALLY CERTIFIED | BLOCKED |
| 13 | Release approval and rollback readiness | e2e P13; `npm run release:check` → READY_FOR_APPROVAL; `pilot-ops.test.ts` (tamper, policy-change, bot approval, separate authorizations, missing rollback) | LOCALLY CERTIFIED | Awaiting human approvals (by design) |

## Defects found during certification
- KLY-SEC-014 (test-only mock auth): duplicate one-time codes within the same second. Fixed with a nonce and a
  regression test.

## Pilot operational status
**Not operational.** The pilot is fully implemented and locally certified, but it is not activated. Hosted
Auth/RLS, licensed market data (SPX via Polygon/Massive, MNQ via CME Globex) and hosted runtime recovery remain
unverified. Migrations 0001–0004 are not applied to any hosted project. The 0.8.0 manifest has no human approvals and
no deployment or migration authorization.
