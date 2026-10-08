"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";

/** Explicit, versioned risk acknowledgement + pilot consent. Nothing is pre-checked. */
export function PilotActivation() {
  const id = { risk: useId(), consent: useId() };
  const [risk, setRisk] = useState(false);
  const [consent, setConsent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const activate = async () => {
    setErr(null);
    setBusy(true);
    const res = await fetch("/api/pilot/activate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ riskAcknowledged: risk, consent }) });
    setBusy(false);
    if (!res.ok) return setErr(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Activation failed");
    window.location.assign("/app");
  };
  return (
    <form
      className="mt-4 grid gap-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        void activate();
      }}
    >
      <label htmlFor={id.risk} className="flex items-start gap-2">
        <input id={id.risk} type="checkbox" checked={risk} onChange={(e) => setRisk(e.target.checked)} className="mt-1" />
        <span>
          I understand that Klynge is not financial advice, that trading involves substantial risk and that I may lose 100% of the capital committed to a trade. Klynge states describe whether conditions are met; they are not recommendations, and Klynge never places trades.
        </span>
      </label>
      <label htmlFor={id.consent} className="flex items-start gap-2">
        <input id={id.consent} type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
        <span>I agree to take part in the Klynge pilot. My sessions, decisions, journal and feedback are stored in my account to evaluate and improve Klynge; I can export or delete my data at any time.</span>
      </label>
      <div>
        <Button variant="primary" disabled={!risk || !consent || busy} type="submit">
          Activate pilot access
        </Button>
      </div>
      <p aria-live="polite" className="min-h-5 text-k-danger" data-testid="pilot-error">
        {err}
      </p>
    </form>
  );
}
