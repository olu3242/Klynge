"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { ProvenanceBadge } from "@/components/status";
import { COMPACT_RISK_NOTICE } from "@/lib/notices";
import type { ChartView, DataDecisionView, FieldView, VisualContextView, WorkspaceView } from "@/lib/view-model";

const ROLES = [
  { value: "", label: "Detect automatically" },
  { value: "TARGET", label: "Target" },
  { value: "SPX", label: "SPX (broad market)" },
  { value: "MNQ", label: "MNQ (tech confirmation)" },
  { value: "VOLUME_PROXY", label: "Volume proxy" },
];
const TIMEFRAMES = ["", "1m", "5m", "15m", "30m", "1h", "4h", "1d"];
const EDIT_OPTIONS: Record<string, string[]> = {
  timeframe: TIMEFRAMES.slice(1),
  priceVsVwap: ["ABOVE", "BELOW", "AT"],
  structure: ["HH_HL", "LH_LL", "MIXED"],
  vwapVisible: ["true", "false"],
  volumeVisibility: ["FULL", "PARTIAL", "NONE"],
};
const EDITABLE = new Set(["symbol", "timeframe", "lastPrice", "priceVsVwap", "structure", "vwapVisible", "volumeVisibility"]);

async function call(url: string, init: RequestInit): Promise<WorkspaceView> {
  const res = await fetch(url, init);
  const body = (await res.json()) as WorkspaceView & { error?: string };
  if (!res.ok) throw new Error(body.error ?? "Request failed");
  return body;
}

export function Workspace({ initial }: { initial: WorkspaceView }) {
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState("");
  const [symbol, setSymbol] = useState("");
  const [timeframe, setTimeframe] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const ids = { role: useId(), symbol: useId(), tf: useId(), file: useId(), ohlcv: useId(), note: useId() };

  const run = useCallback(async (fn: () => Promise<WorkspaceView>) => {
    setBusy(true);
    setError(null);
    try {
      setView(await fn());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  const upload = useCallback(
    (file: File) =>
      run(() => {
        const fd = new FormData();
        fd.set("chart", file);
        if (symbol) fd.set("symbol", symbol);
        if (timeframe) fd.set("timeframe", timeframe);
        if (role) fd.set("role", role);
        return call("/api/charts", { method: "POST", body: fd });
      }),
    [run, symbol, timeframe, role],
  );

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (file) {
        e.preventDefault();
        void upload(file);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [upload]);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void upload(file);
  };

  const presetRole = (r: string) => {
    setRole(r);
    fileRef.current?.focus();
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-k-lime">Visual analysis</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">What are you looking at?</h1>
        <p className="mt-2 max-w-2xl text-k-secondary">
          Klynge reads what is visible on your chart, tells you what it could not verify, and what it still needs before reaching a conclusion.
        </p>
      </div>

      <Card aria-labelledby="upload-title">
        <CardTitle id="upload-title">Chart intake</CardTitle>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`mt-4 grid place-items-center rounded-xl border-2 border-dashed p-8 text-center transition-colors ${dragging ? "border-k-lime bg-k-lime/5" : "border-k-border"}`}
        >
          <p className="text-lg font-semibold">Drop your market chart here</p>
          <p className="mt-1 text-sm text-k-secondary">PNG · JPG · WebP · or paste a screenshot</p>
          <label htmlFor={ids.file} className="mt-4 inline-flex min-h-10 cursor-pointer items-center rounded-lg bg-k-lime px-4 text-sm font-semibold text-k-black hover:bg-k-lime-bright">
            Upload chart
          </label>
          <input
            ref={fileRef}
            id={ids.file}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            disabled={busy}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = "";
            }}
          />
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Field label="Symbol (optional)" id={ids.symbol}>
            <input id={ids.symbol} value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} placeholder="e.g. TSLA" className="input" maxLength={12} />
          </Field>
          <Field label="Timeframe (optional)" id={ids.tf}>
            <select id={ids.tf} value={timeframe} onChange={(e) => setTimeframe(e.target.value)} className="input">
              {TIMEFRAMES.map((t) => (
                <option key={t} value={t}>
                  {t || "Detect"}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Chart role" id={ids.role}>
            <select id={ids.role} value={role} onChange={(e) => setRole(e.target.value)} className="input">
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <p className="mt-3 text-xs text-k-secondary">
          Screenshots may show account details. Images are re-encoded without metadata, kept only for this session and never logged.
        </p>
        <div aria-live="polite" className="mt-3 min-h-5 text-sm">
          {busy && <span className="text-k-secondary">Klynge is reading your chart…</span>}
          {error && <span className="text-k-danger" role="alert">⚠ {error}</span>}
        </div>
      </Card>

      <Completeness view={view} onAdd={presetRole} />

      {view.visual && <VisualContextCard ctx={view.visual} onAdd={presetRole} />}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
        {view.charts.map((c) => (
          <ChartCard key={c.chartId} chart={c} busy={busy} onConfirm={(field, action, value) => run(() => call("/api/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chartId: c.chartId, field, action, value }) }))} />
        ))}
      </div>

      <DataImport busy={busy} id={ids.ohlcv} onImport={(text) => run(() => call("/api/ohlcv", { method: "POST", headers: { "content-type": "application/json" }, body: text }))} />
      {view.data && <DataDecisionCard d={view.data} />}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
        <Card aria-labelledby="alerts-title">
          <CardTitle id="alerts-title">Alerts</CardTitle>
          {view.alerts.length === 0 ? (
            <p className="mt-3 text-sm text-k-secondary">No state changes yet.</p>
          ) : (
            <ul className="mt-3 grid gap-2 text-sm">
              {view.alerts.map((a) => (
                <li key={a.alertId} className="rounded-lg border border-k-border p-3">
                  <Badge tone={a.severity === "WARNING" ? "warning" : a.severity === "ATTENTION" ? "lime" : "neutral"}>{a.severity}</Badge>{" "}
                  <span className="text-xs text-k-secondary">{a.evidenceMode}</span>
                  <p className="mt-1">{a.message}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Journal view={view} id={ids.note} busy={busy} onAdd={(note) => run(() => call("/api/journal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ recordId: view.latestRecordId, note }) }))} />
      </div>

      <div>
        <Button
          variant="subtle"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await fetch("/api/session/reset", { method: "POST" });
              return call("/api/workspace", { method: "GET" });
            })
          }
        >
          End session and discard images
        </Button>
      </div>
    </div>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-xs font-semibold text-k-secondary">
        {label}
      </label>
      {children}
    </div>
  );
}

function Completeness({ view, onAdd }: { view: WorkspaceView; onAdd: (role: string) => void }) {
  const complete = view.completeness.every((c) => c.present);
  return (
    <Card aria-labelledby="ctx-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle id="ctx-title">Market context</CardTitle>
        <Badge tone={complete ? "success" : "warning"}>
          <span aria-hidden="true">{complete ? "✓" : "◐"}</span> {complete ? "Complete" : "Incomplete"}
        </Badge>
      </div>
      <ul className="mt-4 grid gap-2 sm:grid-cols-3">
        {view.completeness.map((c) => (
          <li key={c.role} className="flex items-center justify-between gap-2 rounded-lg border border-k-border px-3 py-2" data-role={c.role}>
            <span className="font-semibold">{c.symbol ?? (c.role === "TARGET" ? "Target" : c.role)}</span>
            {c.present ? (
              <span className="text-sm text-k-success">
                <span aria-hidden="true">✓</span> Provided
              </span>
            ) : (
              <Button size="sm" onClick={() => onAdd(c.role)}>
                + Add {c.role === "TARGET" ? "target" : c.role} chart
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function List({ title, items, tone }: { title: string; items: string[]; tone?: string }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-k-secondary">{title}</h3>
      <ul className={`mt-2 grid gap-1 text-sm ${tone ?? ""}`}>
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </div>
  );
}

function VisualContextCard({ ctx, onAdd }: { ctx: VisualContextView; onAdd: (role: string) => void }) {
  return (
    <Card aria-labelledby="visual-title" data-testid="visual-context">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle id="visual-title">Klynge — visual analysis</CardTitle>
          <p className="mt-2 text-2xl font-extrabold" data-testid="visual-label">
            {ctx.label}
          </p>
          <p className="text-sm text-k-secondary">Target alone: {ctx.targetContext} · Market (observed): {ctx.regime}</p>
        </div>
        <Badge tone={ctx.permission === "BLOCKED" ? "danger" : "neutral"} data-testid="visual-permission">
          <span aria-hidden="true">{ctx.permission === "BLOCKED" ? "■" : "⏸"}</span> {ctx.permission}
        </Badge>
      </div>
      <p className="mt-4 rounded-lg border border-k-warning/40 bg-k-warning/5 px-3 py-2 text-sm" role="note" data-testid="visual-notice">
        <span aria-hidden="true">⚠ </span>
        {ctx.notice}
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <List title="Why" items={ctx.reasons} />
        <List title="Blockers" items={ctx.blockers} tone="text-k-danger" />
        <List title="Missing" items={ctx.missing} />
        <List title="Not verified" items={ctx.notVerified} tone="text-k-warning" />
      </div>
      {ctx.nextSteps.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-k-secondary">Next steps</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {ctx.nextSteps.map((s) => {
              const m = /\+ Add (SPX|MNQ|target) chart/.exec(s);
              return (
                <li key={s}>
                  {m ? (
                    <Button size="sm" onClick={() => onAdd(m[1] === "target" ? "TARGET" : (m[1] as string))}>
                      {s}
                    </Button>
                  ) : (
                    <span className="text-sm">{s}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <p className="mt-4 text-xs text-k-secondary" role="note">
        {COMPACT_RISK_NOTICE}
      </p>
    </Card>
  );
}

function ChartCard({ chart, busy, onConfirm }: { chart: ChartView; busy: boolean; onConfirm: (field: string, action: "CONFIRM" | "EDIT", value?: unknown) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const submit = (e: FormEvent, f: FieldView) => {
    e.preventDefault();
    const value = f.field === "lastPrice" ? Number(draft) : f.field === "vwapVisible" ? draft === "true" : draft.trim().toUpperCase().replace(/^(\d+)([MHD])$/, (_, n, u) => `${n}${u.toLowerCase()}`);
    onConfirm(f.field, "EDIT", f.field === "timeframe" ? draft : value);
    setEditing(null);
  };
  return (
    <Card aria-label={`${chart.role} chart ${chart.symbol ?? ""}`} data-testid={`chart-${chart.role}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle>{chart.role === "TARGET" ? "Target" : chart.role} chart</CardTitle>
          <p className="mt-1 text-xl font-bold">{chart.symbol ?? "Unknown symbol"}</p>
        </div>
        <Badge tone="neutral">{chart.roleSource === "USER" ? "Role set by you" : "Role detected"}</Badge>
      </div>
      {chart.roleViolation && (
        <p className="mt-3 text-sm text-k-danger" role="alert">
          <span aria-hidden="true">■ </span>
          {chart.roleViolation}
        </p>
      )}
      <div className="mt-4 overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Observed fields</caption>
        <thead className="sr-only">
          <tr>
            <th>Field</th>
            <th>Value</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {chart.fields.map((f) => (
            <tr key={f.field} className="border-t border-k-border align-top" data-field={f.field}>
              <th scope="row" className="py-2 pr-2 text-left font-medium text-k-secondary">
                {f.label}
                {f.required && <span className="sr-only"> (required)</span>}
                {f.required && <span aria-hidden="true" className="text-k-lime"> *</span>}
              </th>
              <td className="py-2 pr-2 break-words">{f.value ?? "—"}</td>
              <td className="py-2 pr-2">
                <ProvenanceBadge status={f.status} />
              </td>
              <td className="py-2 text-right">
                {editing === f.field ? (
                  <form onSubmit={(e) => submit(e, f)} className="flex justify-end gap-1">
                    <label className="sr-only" htmlFor={`${chart.chartId}-${f.field}`}>
                      New {f.label}
                    </label>
                    {EDIT_OPTIONS[f.field] ? (
                      <select id={`${chart.chartId}-${f.field}`} value={draft} onChange={(e) => setDraft(e.target.value)} className="input w-28">
                        {EDIT_OPTIONS[f.field]!.map((o) => (
                          <option key={o}>{o}</option>
                        ))}
                      </select>
                    ) : (
                      <input id={`${chart.chartId}-${f.field}`} value={draft} onChange={(e) => setDraft(e.target.value)} className="input w-28" />
                    )}
                    <Button size="sm" type="submit" disabled={busy}>
                      Save
                    </Button>
                  </form>
                ) : (
                  <div className="flex justify-end gap-1">
                    {f.value !== null && f.status !== "USER_CONFIRMED" && f.status !== "DATA_VERIFIED" && (
                      <Button size="sm" disabled={busy} onClick={() => onConfirm(f.field, "CONFIRM")} aria-label={`Confirm ${f.label}`}>
                        Confirm
                      </Button>
                    )}
                    {EDITABLE.has(f.field) && (
                      <Button
                        size="sm"
                        variant="subtle"
                        disabled={busy}
                        aria-label={`Edit ${f.label}`}
                        onClick={() => {
                          setEditing(f.field);
                          setDraft(EDIT_OPTIONS[f.field]?.[0] ?? f.value ?? "");
                        }}
                      >
                        Edit
                      </Button>
                    )}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      {chart.issues.length > 0 && (
        <details className="mt-3 text-xs text-k-secondary">
          <summary className="cursor-pointer">Validation notes ({chart.issues.length})</summary>
          <ul className="mt-2 grid gap-1">
            {chart.issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

function DataImport({ busy, id, onImport }: { busy: boolean; id: string; onImport: (text: string) => void }) {
  return (
    <Card aria-labelledby="data-title">
      <CardTitle id="data-title">Data analysis (OHLCV)</CardTitle>
      <p className="mt-2 text-sm text-k-secondary">Import OHLCV for the target, SPX and MNQ to run the full deterministic engine. Setups are only possible with data.</p>
      <label htmlFor={id} className="mt-3 inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-k-border px-4 text-sm font-semibold hover:border-k-lime">
        Import OHLCV JSON
      </label>
      <input
        id={id}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        disabled={busy}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) onImport(await f.text());
          e.target.value = "";
        }}
      />
    </Card>
  );
}

function DataDecisionCard({ d }: { d: DataDecisionView }) {
  const directional = d.decision === "CALL_SETUP" || d.decision === "PUT_SETUP";
  return (
    <Card aria-labelledby="decision-title" data-testid="data-decision">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle id="decision-title">Klynge — data analysis · {d.symbol} {d.timeframe}</CardTitle>
          <p className="mt-2 text-2xl font-extrabold" data-testid="data-decision-value">
            {d.decision}
          </p>
          <p className="text-sm text-k-secondary">
            Regime {d.regime} · Target {d.targetDirection} · As of {new Date(d.asOf).toISOString().replace(".000Z", "Z")}
          </p>
        </div>
        <Badge tone={directional ? "success" : d.decision === "BLOCKED" || d.decision === "INVALIDATED" ? "danger" : "neutral"}>
          <span aria-hidden="true">{directional ? "✓" : d.decision === "WAIT" ? "⏸" : "■"}</span> {directional ? "Conditions met" : d.decision}
        </Badge>
      </div>
      <ul className="mt-4 grid gap-1 text-sm sm:grid-cols-2">
        {d.progress.map((p) => (
          <li key={p.stage} className="flex justify-between gap-2 border-b border-k-border py-1.5">
            <span>{p.stage}</span>
            <span className={p.done ? "text-k-success" : "text-k-warning"}>
              <span aria-hidden="true">{p.done ? "✓" : "○"}</span> {p.done ? "Met" : "Pending"}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <List title="Why" items={[d.summary, ...d.reasons]} />
        <List title="Blockers" items={d.blockers} tone="text-k-danger" />
        <List title="Missing" items={d.missing} />
        <List title="What invalidates it" items={d.invalidatesIf} />
      </div>
      {d.risk && (
        <dl className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
          {(
            [
              ["Risk", d.risk.allowed ? d.risk.level : "BLOCKED"],
              ["Entry zone", d.risk.entryZone],
              ["Invalidation", d.risk.invalidation],
              ["Target", d.risk.target],
              ["Reward/risk", d.risk.rewardRisk],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="rounded-lg border border-k-border p-2">
              <dt className="text-xs text-k-secondary">{k}</dt>
              <dd className="font-semibold">{v ?? "—"}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="mt-4 text-xs text-k-secondary" role="note">
        {directional ? "Conditions met is not a recommendation. " : ""}
        {COMPACT_RISK_NOTICE}
      </p>
    </Card>
  );
}

function Journal({ view, id, busy, onAdd }: { view: WorkspaceView; id: string; busy: boolean; onAdd: (note: string) => void }) {
  const [note, setNote] = useState("");
  return (
    <Card aria-labelledby="journal-title">
      <CardTitle id="journal-title">Journal</CardTitle>
      {view.journal.length > 0 && (
        <ul className="mt-3 grid gap-2 text-sm">
          {view.journal.map((j) => (
            <li key={j.entryId} className="rounded-lg border border-k-border p-3">
              {j.note}
            </li>
          ))}
        </ul>
      )}
      <form
        className="mt-3 grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (note.trim()) onAdd(note);
          setNote("");
        }}
      >
        <label htmlFor={id} className="text-xs font-semibold text-k-secondary">
          Note on the latest analysis (your annotation — engine records never change)
        </label>
        <textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} className="input" />
        <Button type="submit" disabled={busy || !view.latestRecordId || !note.trim()}>
          Add note
        </Button>
      </form>
    </Card>
  );
}
