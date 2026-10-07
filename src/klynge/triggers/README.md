# `triggers/` — reserved

Not implemented in `market-truth-v1`. Reserved for the Klynge Setup Engine.
Any future module here MUST gate on `isDirectionallyEligible()` from `policies/invariants.ts`
and must never re-derive regime, data quality or trade permission.
