/**
 * Server-side engine access for plain-node modules (tests + services). Next imports go through
 * ./engine.ts, which adds the `server-only` guard; both resolve to the same deterministic engine source.
 */
import "server-only";

export * from "../../../../src/klynge/index.ts";
