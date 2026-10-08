import "server-only";
import { selectExtractor } from "./extraction/select.ts";
import { RateLimiter } from "./rate-limit.ts";
import { MemoryImageStore, MemorySessionStore } from "./store/memory-store.ts";
import { SupabaseSessionStore } from "./store/supabase-store.ts";
import type { ImageRetention } from "./store/types.ts";
import { consoleTelemetrySink } from "./telemetry.ts";
import type { WorkspaceDeps } from "./workspace.ts";

let deps: WorkspaceDeps | undefined;

/** Process-wide dependencies, configured from server-only env. */
export function runtimeDeps(): WorkspaceDeps {
  if (deps) return deps;
  const env = process.env;
  const retention: ImageRetention = env.KLYNGE_IMAGE_RETENTION === "NONE" ? "NONE" : "SESSION";
  deps = {
    store: env.KLYNGE_STORE === "supabase" ? SupabaseSessionStore.fromEnv(env) : new MemorySessionStore(),
    images: new MemoryImageStore(retention),
    extractor: selectExtractor(env),
    limiter: new RateLimiter(),
    telemetry: consoleTelemetrySink,
  };
  return deps;
}

/** Evaluation clock. A header override exists ONLY when KLYNGE_TEST_CLOCK=1 (e2e); production always uses wall time. */
export function clockFrom(headers: Headers): number {
  if (process.env.KLYNGE_TEST_CLOCK === "1") {
    const v = Number(headers.get("x-klynge-now"));
    if (Number.isSafeInteger(v) && v > 0) return v;
  }
  return Date.now();
}
