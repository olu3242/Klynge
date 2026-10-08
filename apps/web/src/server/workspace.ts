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
  isUsable,
  validateObservation,
} from "./engine-core.ts";
import type { ChartObservation, ChartSession, ConfirmationEdit, KlyngeDecisionState, StateAlert, VisualContextState, VisualPolicy } from "./engine-core.ts";
import type { ExtractionHints, ChartExtractor } from "./extraction/types.ts";
import { processUpload } from "./intake.ts";
import { parseOhlcv } from "./ohlcv.ts";
import type { RateLimiter } from "./rate-limit.ts";
import type { DecisionRecord, ImageStore, SessionStore } from "./store/types.ts";
import { track } from "./telemetry.ts";
import type { TelemetrySink } from "./telemetry.ts";
import { alertView, chartView, completenessView, dataView, visualView } from "./views.ts";
import type { HistoryRowView, WorkspaceView } from "../lib/view-model.ts";

export interface WorkspaceDeps {
  store: SessionStore;
  images: ImageStore;
  extractor: ChartExtractor;
  limiter: RateLimiter;
  telemetry: TelemetrySink;
  visualPolicy?: VisualPolicy;
}

export class WorkspaceError extends Error {
  override readonly name = "WorkspaceError";
  readonly code: "RATE_LIMITED" | "NOT_FOUND" | "INVALID";
  readonly retryAfterMs: number;
  constructor(code: WorkspaceError["code"], message: string, retryAfterMs = 0) {
    super(message);
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 24);

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
  };
  await deps.store.putRecord(record);
  const alert = detectVisualChange(prior?.visual, context);
  if (alert) await deps.store.addAlert(session.tenantId, alert);
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
  await deps.store.putRecord({ recordId: snapshot.snapshotId, tenantId: input.tenantId, sessionId: input.sessionId, symbol, timeframe: decision.timeframe, evidenceMode: "DATA", at: asOf, data: decision });
  const alert: StateAlert | null = detectDecisionChange(previous, decision);
  if (alert) await deps.store.addAlert(input.tenantId, alert);
  track(deps.telemetry, "decision.evaluated", input.tenantId, input.now, { evidenceMode: "DATA", decision: decision.decision, blockers: decision.blockers });
  return getWorkspace(deps, input.tenantId, input.sessionId);
}

export async function addJournalNote(deps: WorkspaceDeps, input: { tenantId: string; recordId: string; note: string; author: string; now: number }): Promise<void> {
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

export async function getWorkspace(deps: WorkspaceDeps, tenantId: string, sessionId: string): Promise<WorkspaceView> {
  const session = await deps.store.getSession(tenantId, sessionId);
  const records = await deps.store.listRecords(tenantId, { sessionId });
  const lastVisual = records.filter((r) => r.evidenceMode === "VISUAL").at(-1);
  const lastData = records.filter((r) => r.evidenceMode === "DATA").at(-1);
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
    data: lastData?.data ? dataView(lastData.data) : null,
    latestRecordId: latest?.recordId ?? null,
    alerts: (await deps.store.listAlerts(tenantId)).slice(0, 20).map(alertView),
    journal: (await deps.store.listJournal(tenantId)).filter((j) => records.some((r) => r.recordId === j.recordId)).map((j) => ({ entryId: j.entryId, recordId: j.recordId, note: j.note, createdAt: j.createdAt })),
  };
}

export async function history(deps: WorkspaceDeps, tenantId: string, symbol?: string): Promise<HistoryRowView[]> {
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
    }));
}
