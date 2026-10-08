/**
 * Client-bundle guard (run after `next build`). The deterministic engine is server-only: no engine code, rule
 * versions, thresholds, policy names or secrets may appear in any browser-delivered chunk.
 *   node scripts/check-client-bundle.mjs [dir]   (default .next/static)
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const dir = path.resolve(process.argv[2] ?? ".next/static");
export const MARKERS = [
  // engine identity / rule versions
  /production-calibration-v1|auth-live-data-v1|visual-intake-v1|mtf-options-v1|setup-engine-v1|market-truth-v1/,
  // calibration, backtest, user-policy, calendar, notification internals
  /sensitivitySweep|runBacktest|simulateTrades|CONSERVATIVE_EXECUTION|applyUserPolicy|proposePolicyChange|NYSE_HOLIDAYS|cmeEquityIndexCalendar|composeNotification|DEDUPE_WINDOW_MS/,
  // provider normalization + runtime internals
  /normalizeFeed|assembleFeeds|providerFailurePermission|maxFeedSkewMs|maxStalenessMs|runDataCycle|marketStateKey|LiveDataRuntime|RUNTIME_STATE_UNAVAILABLE/,
  // engine internals (policy names, blocker codes, functions)
  /minimumRewardRiskRatio|maximumStopAtr|atrToleranceMultiplier|maxMarketSnapshotSkewMs|maxChartSetSkewMs|minimumConfidence|requiredCloses|minimumCloseDistanceAtr/,
  /INSUFFICIENT_REWARD_RISK|TARGET_REGIME_CONFLICT|INCONSISTENT_STATE|HTF_CONFLICT|LEGAL_TRANSITIONS/,
  /evaluateTradePermission|evaluateSetup|evaluateVisualContext|validateObservation|runPriceAction|discoverLevels/,
  // extraction prompt + secrets
  /You read trading chart screenshots|ANTHROPIC_API_KEY|SUPABASE_SERVICE_ROLE_KEY|sk-ant-[A-Za-z0-9]/,
  // auth + service role + test-only machinery
  /service_role|serviceRoleClient|SERVICE_ROLE_OPERATIONS|KLYNGE_TEST_AUTH_SECRET|klynge_mock_session|x-klynge-provider-scenario|KLYNGE_PROVIDER_API_KEY|POLYGON_API_KEY|RESEND_API_KEY|KLYNGE_CRON_SECRET|api\.polygon\.io|api\.resend\.com/,
  // 0.7.0 pilot-readiness internals: evaluation, futures, worker, operator monitoring, CME credentials
  /pilot-readiness-v1|sealHoldout|outOfSampleReport|decisionAnalytics|calibrationView|replayDays|activeContract|aggregateBars|detectCorporateActions|runNotificationWorker|klynge_claim_notifications|klynge_complete_notification|runtimeCorruption|quarantineCorruptedRuntime|KLYNGE_ADMIN_EMAILS|DATABENTO_API_KEY|GLBX\.MDP3|hist\.databento\.com/,
  // raw JWTs (no token may be compiled into a browser chunk)
  /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}/,
];

function walk(d, out = []) {
  for (const f of readdirSync(d)) {
    const p = path.join(d, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|mjs|css|map|json|txt)$/.test(f)) out.push(p);
  }
  return out;
}

export function scan(root) {
  const hits = [];
  for (const file of walk(root)) {
    const text = readFileSync(file, "utf8");
    for (const re of MARKERS) {
      const m = re.exec(text);
      if (m) hits.push(`${path.relative(root, file)}: ${m[0]}`);
    }
  }
  return hits;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  if (!existsSync(dir)) {
    console.error(`client-bundle check: ${dir} not found — run next build first`);
    process.exit(1);
  }
  const hits = scan(dir);
  if (hits.length) {
    console.error(`client-bundle check FAILED (${hits.length}):\n  ${hits.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`client-bundle check OK (${walk(dir).length} client files, no engine code or secrets)`);
}
