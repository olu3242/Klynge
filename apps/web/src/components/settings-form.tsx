"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { OPTIONS_RISK_NOTICE } from "@/lib/notices";

interface Settings {
  riskPolicy: { maxCapitalExposure: number | null; maxLossPerTrade: number | null; allowedInstruments: string[] | null; sessionPreference: "REGULAR_HOURS_ONLY" | "ANY"; optionsRiskAcknowledged: boolean };
  notifications: { emailEnabled: boolean; emailAddress: string | null; minSeverity: "INFO" | "ATTENTION" | "WARNING"; maxPerHour: number };
}

const num = (s: string) => (s.trim() === "" ? null : Number(s));

export function SettingsForm({ initial, verifiedEmail }: { initial: Settings; verifiedEmail: string | null }) {
  const [s, setS] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const id = { cap: useId(), loss: useId(), inst: useId(), sess: useId(), ack: useId(), email: useId(), sev: useId(), rate: useId() };
  const [cap, setCap] = useState(initial.riskPolicy.maxCapitalExposure?.toString() ?? "");
  const [loss, setLoss] = useState(initial.riskPolicy.maxLossPerTrade?.toString() ?? "");
  const [inst, setInst] = useState(initial.riskPolicy.allowedInstruments?.join(", ") ?? "");
  const save = async () => {
    setMsg(null);
    setErr(null);
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        riskPolicy: { ...s.riskPolicy, maxCapitalExposure: num(cap), maxLossPerTrade: num(loss), allowedInstruments: inst.trim() ? inst.split(/[,\s]+/).filter(Boolean).map((x) => x.toUpperCase()) : null },
        notifications: { emailEnabled: s.notifications.emailEnabled, minSeverity: s.notifications.minSeverity, maxPerHour: s.notifications.maxPerHour },
      }),
    });
    const body = (await res.json()) as Settings & { error?: string };
    if (!res.ok) return setErr(body.error ?? "Could not save");
    setS(body);
    setMsg("Saved.");
  };
  return (
    <form
      className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Card aria-labelledby="risk-title">
        <CardTitle id="risk-title">Risk preferences (restrict only)</CardTitle>
        <div className="mt-3 grid gap-3 text-sm">
          <label htmlFor={id.cap} className="grid gap-1">
            <span className="text-xs font-semibold text-k-secondary">Maximum hypothetical capital per idea</span>
            <input id={id.cap} inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} className="input" placeholder="No limit" />
          </label>
          <label htmlFor={id.loss} className="grid gap-1">
            <span className="text-xs font-semibold text-k-secondary">Maximum loss tolerance per idea</span>
            <input id={id.loss} inputMode="decimal" value={loss} onChange={(e) => setLoss(e.target.value)} className="input" placeholder="No limit" />
          </label>
          <label htmlFor={id.inst} className="grid gap-1">
            <span className="text-xs font-semibold text-k-secondary">Allowed instruments (comma separated)</span>
            <input id={id.inst} value={inst} onChange={(e) => setInst(e.target.value)} className="input" placeholder="Any" />
          </label>
          <label htmlFor={id.sess} className="grid gap-1">
            <span className="text-xs font-semibold text-k-secondary">Trading sessions</span>
            <select id={id.sess} className="input" value={s.riskPolicy.sessionPreference} onChange={(e) => setS({ ...s, riskPolicy: { ...s.riskPolicy, sessionPreference: e.target.value as Settings["riskPolicy"]["sessionPreference"] } })}>
              <option value="ANY">Any session</option>
              <option value="REGULAR_HOURS_ONLY">Regular hours only</option>
            </select>
          </label>
          <label htmlFor={id.ack} className="flex items-start gap-2">
            <input id={id.ack} type="checkbox" checked={s.riskPolicy.optionsRiskAcknowledged} onChange={(e) => setS({ ...s, riskPolicy: { ...s.riskPolicy, optionsRiskAcknowledged: e.target.checked } })} />
            <span>I understand: {OPTIONS_RISK_NOTICE}</span>
          </label>
        </div>
      </Card>
      <Card aria-labelledby="notify-title">
        <CardTitle id="notify-title">Notifications</CardTitle>
        <div className="mt-3 grid gap-3 text-sm">
          <p className="text-k-secondary">In-app alerts are always on. Email describes state changes only — never trade instructions.</p>
          <label htmlFor={id.email} className="flex items-start gap-2">
            <input id={id.email} type="checkbox" disabled={!verifiedEmail} checked={s.notifications.emailEnabled} onChange={(e) => setS({ ...s, notifications: { ...s.notifications, emailEnabled: e.target.checked } })} />
            <span>Email me at my verified address {verifiedEmail ? `(${verifiedEmail})` : "(none on this account)"}</span>
          </label>
          <label htmlFor={id.sev} className="grid gap-1">
            <span className="text-xs font-semibold text-k-secondary">Minimum importance</span>
            <select id={id.sev} className="input" value={s.notifications.minSeverity} onChange={(e) => setS({ ...s, notifications: { ...s.notifications, minSeverity: e.target.value as Settings["notifications"]["minSeverity"] } })}>
              <option value="INFO">All changes</option>
              <option value="ATTENTION">Conditions met and warnings</option>
              <option value="WARNING">Warnings only</option>
            </select>
          </label>
          <label htmlFor={id.rate} className="grid gap-1">
            <span className="text-xs font-semibold text-k-secondary">Maximum emails per hour</span>
            <input id={id.rate} type="number" min={1} max={30} value={s.notifications.maxPerHour} onChange={(e) => setS({ ...s, notifications: { ...s.notifications, maxPerHour: Number(e.target.value) } })} className="input w-24" />
          </label>
        </div>
      </Card>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit">Save settings</Button>
        <span aria-live="polite" className="text-sm">
          {msg && <span data-testid="settings-saved">{msg}</span>}
          {err && (
            <span className="text-k-danger" role="alert">
              ⚠ {err}
            </span>
          )}
        </span>
      </div>
    </form>
  );
}
