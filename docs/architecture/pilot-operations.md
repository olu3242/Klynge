# Pilot operations (INTERNAL): `pilot-operations-v1`, engine 0.8.0

The deterministic policy defaults are **unchanged**. The policy fingerprint in `releases/0.8.0.json` equals the one in
`releases/0.7.0.json`.

## Enrollment (71): migration `0004`, `src/server/pilot/`
- **States.** NOT_INVITED → INVITED (operator invite for an email) → ACTIVE (the user activates their own invite with
  `risk-ack-v1` + `pilot-consent-v1`) → SUSPENDED / COMPLETED (operator only; reinstatement is also operator only).
- **Access mode.** `accessMode()`: production is invite-only unless `KLYNGE_RELEASE_AUTHORIZED=general-availability`
  and `KLYNGE_ACCESS=open` are both set. Elsewhere the default is open. Test mode can force a mode per request.
- **Gate.** `requestContext` → `pilotGateVerdict`. Anonymous callers get SIGN_IN_REQUIRED (401). A user who is not
  ACTIVE gets 403 `PILOT_ACCESS`, and pages redirect to `/pilot`. Operators pass. `pilotGate: false` is allowed only
  for activation, export/deletion and operator routes (source-scan enforced).
- **RLS.**
  - Users see only the invite addressed to their JWT email.
  - Activation is insert-only, needs an unrevoked invite for that email with the same cohort and status ACTIVE, and
    gives users no update grant. A guard trigger keeps identity and consent immutable even for the service role.
  - Feedback is append-only.
  - Triage and the operator audit are service-role only.

## Onboarding (72)
Progress is derived from the user's own state: evidence-modes acknowledgement, a full TARGET/SPX/MNQ chart set,
corrections (confirmation audit), a DATA record, and journal or preferences. The only stored data is timestamps.
Telemetry records the step id only.

## Evidence (73): `pilot/evidence.ts`
`evidence-ledger-v1` is a projection of immutable records. Its classes are SYNTHETIC_FIXTURE (mock providers),
USER_SCREENSHOT (VISUAL), USER_IMPORTED_DATA (no vendor provenance) and VERIFIED_LIVE. Only VERIFIED_LIVE is
`verified`. Entries carry decisions, provenance and data-quality blockers, never prices
(`licensing.pricesIncluded=false`).

## Feedback (74)
Feedback holds ratings (clarity, confidence, usability, usefulness), missing information and a problem report. It is
always USER_REPORTED, rate limited and tied only to the user's own session or record; foreign record ids are dropped.
Operators triage it as NEW / ACKNOWLEDGED / NEEDS_INFO / NOT_A_DEFECT / DEFECT_CONFIRMED (KLY-n defect register).

## Analytics (75): `pilot/analytics.ts`
The analytics report:
- WAIT/BLOCKED rate and setups by ticker, timeframe and regime;
- blockers and provider failures;
- corrections;
- alerts and delivery, including alert problem reports;
- session start, complete sets and abandonment;
- enrollment and onboarding;
- satisfaction.

`accuracy` is always `NOT_MEASURED_BY_FEEDBACK`. Hypothetical outcomes are AVAILABLE only from an
EMPIRICAL_HISTORICAL out-of-sample report. `performanceClaim: "NONE"`.

## Reliability (76)
`failure-injection.test.ts` covers provider outage, stale, rate-limited, missing bars, timestamp disagreement,
incomplete chart sets, out-of-order data, duplicate and concurrent processing, auth expiry, database failure (BLOCKED,
nothing partial, idempotent retry), restart and a worker crash between send and completion.

## Security and privacy (77)
- `GET /api/account/export` returns the user's own rows only, with no images and no message bodies.
  `POST /api/account/delete` requires the typed `DELETE MY DATA` confirmation and works on in-process stores. Hosted
  deletion follows `docs/runbooks/account-deletion.md`.
- The findings register is `docs/security/findings-register.md`, and its format is enforced by
  `security-audit.test.ts`.

## Control plane (78)
- `/app/ops/pilot` and `GET|POST /api/admin/pilot` are for operators only (404 otherwise). They cover invitations,
  enrollment status, feedback and support triage, dead-letter requeue, incidents, analytics, release status and the
  operational audit history (`op_…` refs, no PII).
- Hosted administration runs through `npm run pilot:admin` (allow-listed `pilot.admin`).

## Release governance (79)
`releases/<version>.json` + `src/server/release/manifest.ts` + `npm run release:check`. See `docs/release/governance.md`.
