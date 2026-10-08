/**
 * Test mode enables the injectable clock, provider scenarios and mock auth for offline e2e. It must never be on in
 * a real deployment: production builds refuse it when a hosting environment says "production".
 */
export function isTestMode(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  if (env.KLYNGE_TEST_MODE !== "1") return false;
  if (env.VERCEL_ENV === "production" || env.KLYNGE_DEPLOYMENT === "production") throw new Error("KLYNGE_TEST_MODE cannot be enabled in a production deployment");
  // A production build only runs test mode inside the e2e harness, which sets KLYNGE_E2E_RUN explicitly.
  if (env.NODE_ENV === "production" && env.KLYNGE_E2E_RUN !== "1") throw new Error("KLYNGE_TEST_MODE in a production build requires the e2e harness (KLYNGE_E2E_RUN=1)");
  return true;
}
