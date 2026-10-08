import { createHash } from "node:crypto";
import {
  addChart,
  buildDataSnapshot,
  buildVisualSnapshot,
  confirmInSession,
  DEFAULT_VISUAL_POLICY,
  detectDecisionChange,
  detectVisualChange,
  evaluateSnapshot,
  handoffFromVisual,
  isUsable,
  runDataCycle,
  validateObservation,
} from "./engine-core.ts";
import type { ChartObservation, ChartSession, ConfirmationEdit, CycleOutcome, KlyngeDecisionState, RuntimeStore, StateAlert, VisualContextState, VisualPolicy } from "./engine-core.ts";
import type { MarketDataSetup } from "./market-data.ts";
import { applyUserPolicy, DEFAULT_USER_RISK_POLICY } from "./engine-core.ts";
import type { AccountStore, PolicyVerdictRecord } from "./account/types.ts";
import { audit, deliverPending, queueAlertNotification } from "./notifications/dispatcher.ts";
import type { PilotStore } from "./pilot/types.ts";
import type { EmailProvider } from "./notifications/email.ts";
import type { ExtractionHints, ChartExtractor } from "./extraction/types.ts";
import { processUpload } from "./intake.ts";
import { parseOhlcv } from "./ohlcv.ts";
import type { RateLimiter } from "./rate-limit.ts";
import type { DecisionRecord, ImageStore, SessionStore, StoredSession } from "./store/types.ts";
import { track } from "./telemetry.ts";
import type { TelemetrySink } from "./telemetry.ts";
import { alertView, chartView, completenessView, dataView, evidenceView, runtimeView, visualView } from "./views.ts";
import type { AccountView, HistoryRowView, RuntimeView, WorkspaceView } from "../lib/view-model.ts";

export interface WorkspaceDeps {
  store: SessionStore;
  images: ImageStore;
  extractor: ChartExtractor;
  limiter: RateLimiter;
  telemetry: TelemetrySink;
  visualPolicy?: VisualPolicy;
  /** Verified market-data provider (DATA mode). Absent => connecting data is unavailable. */
  market?: MarketDataSetup | null;
  /** Verified users only: preferences, policy verdicts, notification outbox, audit log. */
  account?: AccountStore | null;
  /** Verified users only: pilot enrollment, onboarding, feedback (never decisions). */
  pilot?: PilotStore | null;
  email?: EmailProvider | null;
}

/** Alerts describe state changes; notifications describe alerts. Delivery is best-effort and never blocks a decision. */
async function onAlertCreated(deps: WorkspaceDeps, tenantId: string, alert: StateAlert, now: number): Promise<void> {
  if (!deps.account) return;
  try {
    await queueAlertNotification(deps.account, tenantId, alert, now);
    if (deps.email) await deliverPending(deps.account, deps.email, tenantId, now);
  } catch {
    // Delivery failures are retried by the dispatcher; they never affect engine state.
  }
}

/** User risk policy verdict for a persisted DATA decision — stored SEPARATELY from the immutable engine record. */
async function recordVerdict(deps: WorkspaceDeps, tenantId: string, record: DecisionRecord): Promise<void> {
  if (!deps.account || !record.data) return;
  const policy = (await deps.account.getPolicy(tenantId)) ?? DEFAULT_USER_RISK_POLICY;
  const cal = deps.market?.calendar;
  const regularSession = cal ? (cal.status ? cal.status(record.marketTimestamp ?? record.at) === "OPEN" : cal.sessionAt(record.marketTimestamp ?? record.at) !== null) : true;
  const v = applyUserPolicy({ decision: record.data, options: record.options ?? null, policy, regularSession });
  await deps.account.putVerdict({ recordId: record.recordId, tenantId, at: record.at, engineDecision: v.engineDecision, withinUserPolicy: v.withinUserPolicy, vetoes: [...v.vetoes], policyVersion: policy.version });
}

export class WorkspaceError extends Error {
  override readonly name = "WorkspaceError";
  readonly code: "RATE_LIMITED" | "NOT_FOUND" | "INVALID" | "AUTH_REQUIRED";
  readonly retryAfterMs: number;
  constructor(code: WorkspaceError["code"], message: string, retryAfterMs = 0) {
    super(message);
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 24);

/** NO VERIFIED USER → NO DURABLE USER-OWNED MARKET SESSION. */
function requireDurable(deps: WorkspaceDeps, what: string): void {
  if (deps.store.durability !== "DURABLE") throw new WorkspaceError("AUTH_REQUIRED", `Sign in to ${what}. Trial analyses are not saved.`);
}

async function loadSession(deps: WorkspaceDeps, tenantId: string, sessionId: string, now: number): Promise<ChartSession> {
  return (await deps.store.getSession(tenantId, sessionId)) ?? { sessionId, tenantId, createdAt: now, charts: [] };
}

/** Reconcile user hints with observations: agreement keeps OBSERVED; conflict => NOT_VERIFIED; absence => user-confirmed (audited). */
function reconcileHints(observation: ChartObservation, hints: ExtractionHints, issues: string[]): { observation: ChartObservation; confirmFromHint: ConfirmationEdit[] } {
  const confirmFromHint: ConfirmationEdit[] = [];
  let o = observation;
  for (const field of ["symbol", "timeframe"] as const) {
    const hint = hints[field];
    if (!hint) continue;
    const f = o[field];
    if (isUsable(f.status) && f.value !== hint) {
      o = { ...o, [field]: { ...f, status: "NOT_VERIFIED" } };
      issues.push(`${field}: your hint ${hint} conflicts with the chart (${String(f.value)}); please confirm`);
    } else if (!isUsable(f.status)) confirmFromHint.push({ field, action: "EDIT", value: hint });
  }
  return { observation: o, confirmFromHint };
}

async function evaluateVisual(deps: WorkspaceDeps, session: ChartSession, now: number): Promise<{ context: VisualContextState; recordId: string }> {
  const snapshot = buildVisualSnapshot(session, now);
  track(deps.telemetry, "snapshot.built", session.tenantId, now, { evidenceMode: "VISUAL", charts: session.charts.length });
  const evaluation = evaluateSnapshot(snapshot, { now, visualPolicy: deps.visualPolicy ?? DEFAULT_VISUAL_POLICY });
  if (evaluation.evidenceMode !== "VISUAL") throw new Error("unreachable");
  const context = evaluation.context;
  const prior = (await deps.store.listRecords(session.tenantId, { sessionId: session.sessionId })).filter((r) => r.evidenceMode === "VISUAL").at(-1);
  const record: DecisionRecord = {
    recordId: snapshot.snapshotId,
    tenantId: session.tenantId,
    sessionId: session.sessionId,
    symbol: context.targetSymbol ?? "UNKNOWN",
    timeframe: null,
    evidenceMode: "VISUAL",
    at: now,
    visual: context,
    ...((session as StoredSession).origin ? { origin: (session as StoredSession).origin } : {}),
  };
  await deps.store.putRecord(record);
  const alert = detectVisualChange(prior?.visual, context);
  // Trial sessions never persist alerts.
  if (alert && deps.store.durability === "DURABLE" && (await deps.store.addAlert(session.tenantId, alert))) await onAlertCreated(deps, session.tenantId, alert, now);
  track(deps.telemetry, "decision.evaluated", session.tenantId, now, { evidenceMode: "VISUAL", label: context.label, permission: context.permission, blockers: context.blockers });
  return { context, recordId: record.recordId };
}

/** Upload → intake → rate limit → extract → validate → hints → session → snapshot → visual context → persist. */
export async function uploadChart(
  deps: WorkspaceDeps,
  input: { tenantId: string; sessionId: string; bytes: Uint8Array; hints: ExtractionHints; actor: string; now: number },
): Promise<WorkspaceView> {
  const { tenantId, sessionId, now } = input;
  const rl = deps.limiter.take(tenantId, now);
  if (!rl.allowed) {
    track(deps.telemetry, "rate.limited", tenantId, now, { retryAfterMs: rl.retryAfterMs });
    throw new WorkspaceError("RATE_LIMITED", "Too many chart uploads — try again shortly", rl.retryAfterMs);
  }
  const image = await processUpload(input.bytes).catch((e: unknown) => {
    track(deps.telemetry, "chart.intake", tenantId, now, { outcome: "rejected" });
    throw e; // IntakeError → 413/415 at the HTTP edge
  });
  track(deps.telemetry, "chart.intake", tenantId, now, { mime: image.mime, width: image.width, height: image.height, bytes: image.bytes.byteLength, outcome: "accepted" });
  deps.images.put(tenantId, sessionId, image.sha256, image.bytes);

  const t0 = Date.now();
  const extraction = await deps.extractor.extract(image, input.hints).catch((e: Error) => ({ raw: null, provider: deps.extractor.provider, failure: e.name }));
  const validated = validateObservation(extraction.raw, deps.visualPolicy ?? DEFAULT_VISUAL_POLICY);
  const issues = [...validated.issues, ...(extraction.failure ? [`extraction: ${extraction.failure}`] : [])];
  const { observation, confirmFromHint } = reconcileHints(validated.observation, input.hints, issues);
  const statuses = Object.values(observation).map((f) => f.status);
  track(deps.telemetry, "chart.extraction", tenantId, now, {
    provider: extraction.provider,
    outcome: extraction.failure ? "empty" : "ok",
    observedFields: statuses.filter((s) => s === "OBSERVED").length,
    notVerifiedFields: statuses.filter((s) => s === "NOT_VERIFIED").length,
    durationMs: Date.now() - t0,
  });

  let session = addChart(await loadSession(deps, tenantId, sessionId, now), {
    chartId: image.sha256.slice(0, 24),
    observation,
    issues,
    uploadedAt: now,
    ...(input.hints.role ? { roleOverride: input.hints.role } : {}),
  });
  for (const edit of confirmFromHint) {
    session = confirmInSession(session, image.sha256.slice(0, 24), edit, `${input.actor} (hint)`, now);
    track(deps.telemetry, "chart.confirmation", tenantId, now, { field: edit.field, action: "HINT" });
  }
  await deps.store.putSession(session);
  if (deps.images.retention === "NONE") deps.images.purgeSession(tenantId, sessionId);
  await evaluateVisual(deps, session, now);
  return getWorkspace(deps, tenantId, sessionId);
}

export async function confirmField(
  deps: WorkspaceDeps,
  input: { tenantId: string; sessionId: string; chartId: string; edit: ConfirmationEdit; actor: string; now: number },
): Promise<WorkspaceView> {
  const session = await deps.store.getSession(input.tenantId, input.sessionId);
  if (!session) throw new WorkspaceError("NOT_FOUND", "Session not found");
  let next: ChartSession;
  try {
    next = confirmInSession(session, input.chartId, input.edit, input.actor, input.now);
  } catch (e) {
    throw new WorkspaceError("INVALID", (e as Error).message);
  }
  track(deps.telemetry, "chart.confirmation", input.tenantId, input.now, { field: input.edit.field, action: input.edit.action });
  await deps.store.putSession(next);
  await evaluateVisual(deps, next, input.now);
  return getWorkspace(deps, input.tenantId, input.sessionId);
}

/** DATA mode: OHLCV import → DATA snapshot → existing pipeline, chaining the persisted previous decision. */
export async function importOhlcv(deps: WorkspaceDeps, input: { tenantId: string; sessionId: string; json: unknown; now: number }): Promise<WorkspaceView> {
  requireDurable(deps, "import market data");
  let payload;
  try {
    payload = parseOhlcv(input.json);
  } catch (e) {
    throw new WorkspaceError("INVALID", (e as Error).message);
  }
  const asOf = payload.asOf ?? input.now;
  const { asOf: _a, ...data } = payload;
  const snapshot = buildDataSnapshot(input.sessionId, data, asOf);
  track(deps.telemetry, "snapshot.built", input.tenantId, input.now, { evidenceMode: "DATA", charts: 3 + (data.volumeProxy ? 1 : 0) });
  const symbol = snapshot.targetSymbol ?? "UNKNOWN";
  const priorRecords = (await deps.store.listRecords(input.tenantId, { symbol })).filter((r) => r.evidenceMode === "DATA" && r.data && r.at < asOf);
  const previous: KlyngeDecisionState | undefined = priorRecords.at(-1)?.data;
  const evaluation = evaluateSnapshot(snapshot, { now: asOf, ...(previous ? { previous } : {}) });
  if (evaluation.evidenceMode !== "DATA") throw new Error("unreachable");
  const decision = evaluation.result.setup;
  const marketTimestamp = data.target.at(-1)?.candles.at(-1)?.timestamp ?? asOf;
  const record: DecisionRecord = { recordId: snapshot.snapshotId, tenantId: input.tenantId, sessionId: input.sessionId, symbol, timeframe: decision.timeframe, evidenceMode: "DATA", at: asOf, data: decision, marketTimestamp };
  await deps.store.putRecord(record);
  await recordVerdict(deps, input.tenantId, record);
  const alert: StateAlert | null = detectDecisionChange(previous, decision);
  if (alert && (await deps.store.addAlert(input.tenantId, alert))) await onAlertCreated(deps, input.tenantId, alert, input.now);
  track(deps.telemetry, "decision.evaluated", input.tenantId, input.now, { evidenceMode: "DATA", decision: decision.decision, blockers: decision.blockers });
  return getWorkspace(deps, input.tenantId, input.sessionId);
}

export async function addJournalNote(deps: WorkspaceDeps, input: { tenantId: string; recordId: string; note: string; author: string; now: number }): Promise<void> {
  requireDurable(deps, "keep a journal");
  const note = input.note.trim().slice(0, 2000);
  if (!note) throw new WorkspaceError("INVALID", "Note is empty");
  const record = (await deps.store.listRecords(input.tenantId)).find((r) => r.recordId === input.recordId);
  if (!record) throw new WorkspaceError("NOT_FOUND", "Record not found");
  await deps.store.addJournal({ entryId: sha(`${input.tenantId}|${input.recordId}|${input.now}|${note}`), tenantId: input.tenantId, recordId: input.recordId, symbol: record.symbol, note, author: input.author, createdAt: input.now });
}

export async function resetSession(deps: WorkspaceDeps, tenantId: string, sessionId: string): Promise<void> {
  deps.images.purgeSession(tenantId, sessionId);
  await deps.store.deleteSession(tenantId, sessionId);
}

export async function getWorkspace(
  deps: WorkspaceDeps,
  tenantId: string,
  sessionId: string,
  extras: { account?: Partial<AccountView>; runtime?: RuntimeView | null } = {},
): Promise<WorkspaceView> {
  const session = await deps.store.getSession(tenantId, sessionId);
  const records = await deps.store.listRecords(tenantId, { sessionId });
  const lastVisual = records.filter((r) => r.evidenceMode === "VISUAL").at(-1);
  const lastData = records.filter((r) => r.evidenceMode === "DATA").at(-1);
  const verdict: PolicyVerdictRecord | undefined = lastData && deps.account ? (await deps.account.listVerdicts(tenantId)).find((v) => v.recordId === lastData.recordId) : undefined;
  const latest = records.at(-1);
  return {
    sessionId,
    charts: (session?.charts ?? []).map(chartView),
    completeness: session ? completenessView(session) : [
      { role: "TARGET", present: false, symbol: null },
      { role: "SPX", present: false, symbol: null },
      { role: "MNQ", present: false, symbol: null },
    ],
    visual: lastVisual?.visual ? visualView(lastVisual.visual) : null,
    data: lastData?.data ? dataView(lastData.data, lastData, verdict ?? null) : null,
    evidence: evidenceView(Boolean(lastVisual?.visual), Boolean(lastData?.data)),
    account: {
      kind: deps.store.durability === "DURABLE" ? "USER" : "TRIAL",
      email: null,
      authEnabled: false,
      promotionAvailable: false,
      dataAvailable: Boolean(deps.market),
      origin: session?.origin ?? (deps.store.durability === "DURABLE" ? "DIRECT" : "TRIAL"),
      ...extras.account,
    },
    runtime: extras.runtime ?? null,
    latestRecordId: latest?.recordId ?? null,
    alerts: (await deps.store.listAlerts(tenantId)).slice(0, 20).map(alertView),
    journal: (await deps.store.listJournal(tenantId)).filter((j) => records.some((r) => r.recordId === j.recordId)).map((j) => ({ entryId: j.entryId, recordId: j.recordId, note: j.note, createdAt: j.createdAt })),
  };
}

export async function history(deps: WorkspaceDeps, tenantId: string, symbol?: string): Promise<HistoryRowView[]> {
  requireDurable(deps, "see your history");
  const records = await deps.store.listRecords(tenantId, symbol ? { symbol } : {});
  const journal = await deps.store.listJournal(tenantId);
  return records
    .slice()
    .reverse()
    .map((r) => ({
      recordId: r.recordId,
      symbol: r.symbol,
      evidenceMode: r.evidenceMode,
      state: r.visual ? r.visual.label : (r.data?.decision ?? "—"),
      permission: r.visual ? r.visual.permission : r.data?.decision === "CALL_SETUP" || r.data?.decision === "PUT_SETUP" ? "CONDITIONS MET" : (r.data?.decision ?? "—"),
      at: r.at,
      notes: journal.filter((j) => j.recordId === r.recordId).length,
      origin: r.origin ?? "DIRECT",
    }));
}

/**
 * Explicit anonymous promotion (only after the signed-in user accepts "Save this analysis to your account?").
 * COPIES the trial snapshot into a NEW durable session owned by the verified user, tagged origin ANONYMOUS_TRIAL.
 * The trial session itself is never mutated or re-owned.
 */
export async function promoteTrial(
  trialStore: SessionStore,
  userDeps: WorkspaceDeps,
  input: { trialTenantId: string; trialSessionId: string; userId: string; newSessionId: string; now: number },
): Promise<WorkspaceView> {
  requireDurable(userDeps, "save an analysis");
  if (trialStore.durability !== "TRIAL" || !input.trialTenantId.startsWith("trial:")) throw new WorkspaceError("INVALID", "Only trial sessions can be promoted");
  const trial = await trialStore.getSession(input.trialTenantId, input.trialSessionId);
  if (!trial || trial.charts.length === 0) throw new WorkspaceError("NOT_FOUND", "No trial analysis to save");
  const copy: StoredSession = { ...structuredClone(trial), tenantId: input.userId, sessionId: input.newSessionId, origin: "ANONYMOUS_TRIAL", promotedAt: input.now };
  await userDeps.store.putSession(copy);
  await evaluateVisual(userDeps, copy, input.now);
  track(userDeps.telemetry, "session.promoted", input.userId, input.now, { charts: copy.charts.length });
  if (userDeps.account) await audit(userDeps.account, input.userId, input.now, "session.promoted", `${copy.charts.length} chart(s) copied from a trial`);
  return getWorkspace(userDeps, input.userId, input.newSessionId);
}

/** Tenant-scoped RuntimeStore over the durable SessionStore (ownership fixed to the verified user). */
export function runtimeStoreFor(store: SessionStore, tenantId: string, onAlert?: (a: StateAlert) => Promise<void>): RuntimeStore {
  const dataRecords = async (symbol?: string) => (await store.listRecords(tenantId, symbol ? { symbol } : {})).filter((r) => r.evidenceMode === "DATA" && r.data);
  const toPrev = (r: DecisionRecord) => ({ recordId: r.recordId, marketTimestamp: r.marketTimestamp ?? r.at, decision: r.data as KlyngeDecisionState });
  return {
    loadState: (id) => store.getRuntimeState(tenantId, id),
    saveState: (state) => store.putRuntimeState(tenantId, state),
    latestDecision: async (symbol) => {
      const list = (await dataRecords(symbol)).sort((a, b) => (a.marketTimestamp ?? a.at) - (b.marketTimestamp ?? b.at) || a.at - b.at);
      const last = list.at(-1);
      return last ? toPrev(last) : null;
    },
    getDecision: async (recordId) => {
      const r = (await dataRecords()).find((x) => x.recordId === recordId);
      return r ? toPrev(r) : null;
    },
    putDecision: (rec) =>
      store.putRecord({
        recordId: rec.recordId,
        tenantId,
        sessionId: rec.sessionId,
        symbol: rec.symbol,
        timeframe: rec.timeframe,
        evidenceMode: "DATA",
        at: rec.evaluatedAt,
        data: rec.decision,
        marketTimestamp: rec.marketTimestamp,
        options: rec.options,
        marketData: rec.marketData,
        ...(rec.handoff ? { handoff: rec.handoff } : {}),
      }),
    putAlert: async (a) => {
      const created = await store.addAlert(tenantId, a);
      if (created && onAlert) await onAlert(a);
      return created;
    },
  };
}

const SYMBOL = /^[A-Z][A-Z0-9.^/_-]{0,11}$/;

/**
 * VISUAL → DATA handoff: "Connect verified data". The visual session contributes HINTS only (symbol, timeframe,
 * intent); the DATA runtime fetches, normalizes and evaluates verified market data independently, restoring the
 * previous persisted decision automatically.
 */
export async function connectData(
  deps: WorkspaceDeps,
  input: { tenantId: string; sessionId: string; symbol?: string; intent?: string; now: number },
): Promise<WorkspaceView> {
  requireDurable(deps, "connect verified market data");
  const market = deps.market;
  if (!market) throw new WorkspaceError("INVALID", "No verified market-data provider is configured");
  const session = await deps.store.getSession(input.tenantId, input.sessionId);
  const handoff = session ? handoffFromVisual(session, input.now, input.intent) : null;
  const requested = input.symbol?.trim().toUpperCase();
  if (requested && !SYMBOL.test(requested)) throw new WorkspaceError("INVALID", "Enter a valid symbol");
  const target = requested || handoff?.symbolHint;
  if (!target) throw new WorkspaceError("INVALID", "Add a target chart or enter a symbol to connect data");
  const outcome: Readonly<CycleOutcome> = await runDataCycle(
    { provider: market.provider, store: runtimeStoreFor(deps.store, input.tenantId, (a) => onAlertCreated(deps, input.tenantId, a, input.now)) },
    {
      runtimeId: `${input.sessionId}:${target}`,
      sessionId: input.sessionId,
      targetSymbol: target,
      timeframePolicy: market.timeframePolicy,
      historySessions: market.historySessions,
      calendar: market.calendar,
      ...(market.calendars ? { calendars: market.calendars } : {}),
      symbolMap: market.symbolMap,
    },
    input.now,
    handoff ? { handoff } : {},
  );
  if (outcome.kind === "EVALUATED" && outcome.created) {
    const rec = (await deps.store.listRecords(input.tenantId)).find((r) => r.recordId === outcome.recordId);
    if (rec) await recordVerdict(deps, input.tenantId, rec);
  }
  if (deps.account) await audit(deps.account, input.tenantId, input.now, "data.connected", `${target} ${outcome.kind}`);
  track(deps.telemetry, "data.cycle", input.tenantId, input.now, {
    kind: outcome.kind,
    provider: market.provider.id,
    permission: outcome.kind === "PROVIDER_FAILURE" || outcome.kind === "RUNTIME_STATE_UNAVAILABLE" ? outcome.permission : "",
    decision: outcome.kind === "EVALUATED" || outcome.kind === "UNCHANGED" ? outcome.decision.decision : "",
  });
  return getWorkspace(deps, input.tenantId, input.sessionId, { runtime: runtimeView(outcome, target) });
}
