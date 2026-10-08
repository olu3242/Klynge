# Security and privacy findings register: `pilot-operations-v1` (engine 0.8.0)

This is the Batch 77 audit. The scope covers RLS and ownership, the service-role allowlist, screenshot handling,
auth redirects and cookies, CSRF, rate limits, secret storage, cross-tenant isolation, browser bundles, and account
export and deletion. `apps/web/src/server/security-audit.test.ts` enforces this register's format. A CRITICAL
finding can never stay OPEN.

| ID | Severity | Status | Finding | Evidence / action |
|---|---|---|---|---|
| KLY-SEC-001 | HIGH | FIXED | Notification idempotency key was not tenant-scoped, so a provider could drop a second user's email for the same alert | Fixed in 0.7.0: `hash(tenantId \| alertId \| channel)`. Regression in `notification-worker.test.ts` |
| KLY-SEC-002 | MEDIUM | OPEN | Hosted account deletion cannot be self-service, because decision/journal rows are append-only for users | Operator procedure `docs/runbooks/account-deletion.md` (auth user deletion cascades). In-process deletion is certified locally |
| KLY-SEC-003 | MEDIUM | OPEN | The rate limiter is per process (in-memory), so hosted multi-instance deployments do not share buckets | Before scale-out, add a shared limiter (e.g. a Postgres/Redis token bucket). The pilot runs a single instance |
| KLY-SEC-004 | HIGH | OPEN | `npm audit`: `postcss` (high, via `next`) and `braces`/`micromatch`/`fast-glob` (high, dev-only via `@next/eslint-plugin-next`) | Build-time/dev-time paths, no runtime user input reaches them. Upgrade `next` (and its eslint plugin) in a separately approved dependency change |
| KLY-SEC-005 | MEDIUM | VERIFIED | Operator authorization | Server-derived only: verified user + server-only `KLYNGE_ADMIN_EMAILS` + Supabase `app_metadata.klynge_role=admin`. Non-operators get 404. `ops.test.ts`, e2e J12 / journey 9 |
| KLY-SEC-006 | LOW | ACCEPTED | Operators see pilot feedback free text (support content) | Restricted page. Users are shown only as hashed refs. Telemetry carries no free text (`pilot.test.ts`) |
| KLY-SEC-007 | MEDIUM | OPEN | Hosted cross-tenant ops aggregates and pilot admin depend on the service-role operator script, with no request-path dashboard | By design (SERVICE ROLE ≠ USER AUTHORIZATION). Read-only hosted views need an approved, allow-listed reporting function |
| KLY-SEC-008 | INFO | VERIFIED | Screenshot privacy | Metadata stripped and images never persisted (retention NONE/SESSION in memory). Broker/account text is not echoed. Logs carry no image data (e2e §12/§14) |
| KLY-SEC-009 | INFO | VERIFIED | Auth redirects, cookies, CSRF, security headers | `next` sanitized (no off-site redirects). httpOnly/SameSite=Lax/Secure on https. Origin/Sec-Fetch-Site CSRF. CSP + frame-ancestors none (e2e §10b/§13, `security-audit.test.ts`) |
| KLY-SEC-010 | INFO | VERIFIED | Cross-tenant isolation | RLS on every user table (0001–0004), forged tenant/owner rejected, escalation denied (`test/rls/*`). App ownership comes from the verified session only (`security-audit.test.ts`) |
| KLY-SEC-011 | INFO | VERIFIED | Secrets and IP in browser bundles | `bundle:check` markers for 0.5.0–0.8.0 internals and server-only credentials. Client env limited to the Supabase URL and anon key |
| KLY-SEC-012 | LOW | MITIGATED | Pilot access before release authorization | Production defaults to invite-only. `KLYNGE_ACCESS=open` additionally needs `KLYNGE_RELEASE_AUTHORIZED=general-availability`, and hosted readiness fails otherwise |
| KLY-SEC-014 | LOW | FIXED | Test-only mock auth: OAuth codes for the same email in the same second were identical, so the second sign-in was refused | Nonce added to mock code and link claims (test mode only; production uses Supabase Auth). Regression in `pilot.test.ts` |
| KLY-SEC-013 | INFO | VERIFIED | Service-role allowlist | Five operations (`schema.verify`, `certification.test-users`, `maintenance.cleanup`, `notifications.dispatch`, `pilot.admin`). The source scan forbids service-role references on request paths |

## Hosted verification still required
Hosted Auth/RLS (`npm run rls:hosted`), hosted cookie and redirect behaviour behind the production proxy, and the
Supabase Auth redirect allowlist all need verification. They are BLOCKED in this environment because there is no
hosted project access.
