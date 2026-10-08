# Release governance (Batch 79)

Every release has a manifest in `releases/<version>.json`. It pins the engine, rule and app versions, provider-adapter
versions, every migration and rollback (SHA-256), and a **fingerprint of every deterministic policy default**.
`npm run release:check` (in `apps/web`) compares the manifest with the code and prints a verdict:

- **BLOCKED**: something does not match (versions, adapters, a migration or rollback hash, a missing rollback, the
  policy fingerprint), or policy changed without an approved proposal.
- **READY_FOR_APPROVAL**: the code matches. It is waiting on named human approvals, the deployment authorization,
  or a separate authorization for each new migration.
- **APPROVED_FOR_DEPLOYMENT**: ENGINEERING and OPERATIONS sign-offs by named humans, deployment authorized, and
  every new migration authorized for a named project.

New manifests start from `npm run release:check -- --draft`, which never overwrites an existing manifest and is
never pre-approved. Approvals are added by the approvers themselves.

## Responsibilities

| Role | Approves | Escalation |
|---|---|---|
| ENGINEERING | Code, tests, schema and rollback scripts match the manifest | Blocks on any failed check |
| OPERATIONS | Runbooks, monitoring, scheduler/worker, incident on-call | Owns `docs/runbooks/incident-response.md` |
| RISK_POLICY | Any change to the deterministic policy fingerprint (thresholds, rules) | Required whenever the fingerprint changes |
| Project owner | Deployment authorization; each hosted migration (per project ref) | Separately, in writing |

## Rules
1. Deterministic policy changes only via `proposePolicyChange` (empirical, report-only evidence) →
   `approvePolicyChange` (named human) → a new `KLYNGE_RULE_VERSION` → RISK_POLICY sign-off. Bots and agents can
   never approve. Pilot feedback and analytics **never** change production policy automatically. The pilot modules
   cannot reach the policy machinery, and a source-scan test enforces this.
2. Deployment and migrations are authorized separately. A release whose new migration is not authorized stays
   READY_FOR_APPROVAL.
3. Nothing in this repository deploys, applies a hosted migration or calls a paid provider on its own.

## Rollback
1. **App**: redeploy the previous release (`rollback.to` in the manifest). Code rollbacks are safe because every
   schema change is additive or has a rollback script.
2. **Schema**: only if the new schema is the cause. Follow `docs/runbooks/migrations.md#rollback`: export first, then
   run the `.down.sql` scripts in reverse order. Destructive rollbacks (0001, 0002, 0004) need the project owner's
   approval.
3. **Policy**: revert to the previous rule version by redeploying the previous release. Never patch thresholds in
   place.
4. Record the rollback in the incident (counts, versions, time) and re-run `npm run release:check` for the release
   you rolled back to.
