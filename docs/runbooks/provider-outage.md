# Provider outage

## Provider down

Symptom: PROVIDER_DOWN (CRITICAL). DATA evaluations return BLOCKED with "provider unavailable".

1. Check the provider's status page and whether the API key is still valid. Never print the key.
2. Do nothing to the engine. ResilientProvider retries with backoff and a token bucket, and evaluations stay
   BLOCKED until verified data returns.
3. When the provider recovers, the next verified evaluation resumes from the stored runtime cursor (idempotent).

## Degraded

Symptom: PROVIDER_DOWN (WARNING), usually rate limits. Reduce polling frequency. Do not raise retry limits past
the provider's documented terms.

## Missing feed

Symptom: MISSING_FEED. The SPX or MNQ context feed is not licensed or not configured.

- SPX requires an index entitlement (Polygon/Massive `I:SPX`). MNQ requires the CME Globex dataset (`GLBX.MDP3`,
  e.g. `DATABENTO_API_KEY` + `KLYNGE_DATABENTO_DATASETS`).
- **Never** route NQ for MNQ or SPY for SPX. Evaluations stay BLOCKED until the licensed feed exists.
