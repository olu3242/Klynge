"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";

async function act(body: Record<string, unknown>): Promise<string | null> {
  const res = await fetch("/api/admin/pilot", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (res.ok) {
    window.location.reload();
    return null;
  }
  return ((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Action failed";
}

export function InviteForm() {
  const id = useId();
  const [email, setEmail] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-2 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        void act({ action: "invite", email }).then(setErr);
      }}
    >
      <label htmlFor={id} className="grid gap-1">
        <span className="text-xs font-semibold text-k-secondary">Invite email</span>
        <input id={id} type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <Button type="submit" variant="primary">
        Invite
      </Button>
      <span aria-live="polite" className="text-k-danger">
        {err}
      </span>
    </form>
  );
}

export function EnrollmentActions({ tenantRef, status }: { tenantRef: string; status: string }) {
  const [err, setErr] = useState<string | null>(null);
  const go = (next: string) => void act({ action: "set-status", tenantRef, status: next, reason: "operator action" }).then(setErr);
  return (
    <span className="flex flex-wrap gap-2">
      {status !== "SUSPENDED" && (
        <Button size="sm" onClick={() => go("SUSPENDED")} aria-label={`Suspend ${tenantRef}`}>
          Suspend
        </Button>
      )}
      {status !== "ACTIVE" && (
        <Button size="sm" onClick={() => go("ACTIVE")} aria-label={`Reinstate ${tenantRef}`}>
          Reinstate
        </Button>
      )}
      {status !== "COMPLETED" && (
        <Button size="sm" onClick={() => go("COMPLETED")} aria-label={`Complete ${tenantRef}`}>
          Complete
        </Button>
      )}
      <span aria-live="polite" className="text-k-danger">
        {err}
      </span>
    </span>
  );
}

export function TriageForm({ tenantRef, feedbackId, current }: { tenantRef: string; feedbackId: string; current: string }) {
  const ids = { s: useId(), d: useId() };
  const [status, setStatus] = useState(current);
  const [defect, setDefect] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className="mt-2 flex flex-wrap items-end gap-2 text-xs"
      onSubmit={(e) => {
        e.preventDefault();
        void act({ action: "triage", tenantRef, feedbackId, status, defectRef: defect || null }).then(setErr);
      }}
    >
      <label htmlFor={ids.s} className="grid gap-1">
        <span className="font-semibold text-k-secondary">Triage</span>
        <select id={ids.s} className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
          {["NEW", "ACKNOWLEDGED", "NEEDS_INFO", "NOT_A_DEFECT", "DEFECT_CONFIRMED"].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={ids.d} className="grid gap-1">
        <span className="font-semibold text-k-secondary">Defect ref (KLY-n)</span>
        <input id={ids.d} className="input w-28" value={defect} onChange={(e) => setDefect(e.target.value)} />
      </label>
      <Button size="sm" type="submit">
        Save triage
      </Button>
      <span aria-live="polite" className="text-k-danger">
        {err}
      </span>
    </form>
  );
}

export function RequeueButton({ notificationId }: { notificationId: string }) {
  const [err, setErr] = useState<string | null>(null);
  return (
    <span>
      <Button size="sm" onClick={() => void act({ action: "requeue", notificationId }).then(setErr)}>
        Requeue
      </Button>
      <span aria-live="polite" className="text-k-danger">
        {err}
      </span>
    </span>
  );
}
