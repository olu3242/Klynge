# Workflow OS E2E certification gate (staged)

Status: **NO-GO**. This document records required execution, not a certification claim.

## Scope
- Migration sequence: 0005 through 0010 (not applied).
- Runtime approvals: verified Supabase Auth app role, no mock, same tenant, no self-approval.
- Workflow transition: atomic approval decision and WAITING_HUMAN -> READY (approval) / BLOCKED (rejection).
- No brokerage execution, no unattended production enablement.

## Required isolated PostgreSQL integration tests
1. Apply staged migrations to a disposable Supabase-compatible Postgres instance with auth.users, authenticated/anon/service_role roles.
2. Inspect grants: anon and authenticated cannot SELECT/INSERT/UPDATE workflow tables or EXECUTE security-definer functions. Verify PUBLIC execute revoked.
3. Concurrent workers claim one due job: exactly one lease holder; token increases on reclaim; stale worker cannot renew, finish, or complete.
4. Concurrent reviewers decide one pending approval: exactly one successful transition; approval and workflow status commit or roll back together.
5. Expired, cross-tenant, self-approval, replay event, stale revision and non-WAITING_HUMAN attempts return false with no row changes.
6. Transaction fault injection: force workflow update failure; verify approval remains PENDING.
7. Checkpoint completion: invalid lease or duplicate event never persists a checkpoint.
8. Execute all tests against the exact database role configured for runtime, not merely the database owner.

## Application/browser E2E
- Authenticated approver with server-controlled role receives a decision; request has no user-supplied reviewer identity.
- Unauthenticated, mock, cross-tenant and unauthorized users cannot approve.
- Two simultaneous submissions: one success, one denied; UI reflects resulting workflow state.
- Rejection yields BLOCKED; approval yields READY, never RUNNING or a trade.
- With KLYNGE_WORKFLOW_APPROVAL_API unset, endpoint responds 404.

## Release blocking items
- The current HTTP route uses the legacy approval repository update, **not** the new atomic approval transition. Must wire an authenticated service boundary to the atomic transition before release.
- SQL migrations are staged only; migration rollback, backup and least-privilege database role certification are outstanding.
- No disposable PostgreSQL test run or browser run was performed in this change.
- Previous GitHub Actions run 38029467973: subscriber static/unit job succeeded, deterministic engine job failed; it does not certify this workflow change.
- Never enable the approval API, migrate hosted DB, deploy, or merge without separate approval.
