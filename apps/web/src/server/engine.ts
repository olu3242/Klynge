/**
 * The ONLY bridge from the product app to the deterministic engine. `server-only` makes any client import
 * a build error; scripts/check-client-bundle.mjs additionally scans built client chunks for engine code.
 */
import "server-only";

export * from "../../../../src/klynge/index.ts";
