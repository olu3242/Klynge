"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";

/** Account-data privacy controls (Batch 77): export everything, or delete with an explicit typed confirmation. */
export function AccountData() {
  const id = useId();
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const del = async () => {
    setMsg(null);
    const res = await fetch("/api/account/delete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmation: confirm }) });
    const body = (await res.json().catch(() => ({}))) as { error?: string; deleted?: number };
    if (!res.ok) return setMsg(body.error ?? "Deletion failed");
    setMsg(`Deleted ${body.deleted ?? 0} item(s). Signing you out…`);
    const f = document.createElement("form");
    f.method = "post";
    f.action = "/auth/sign-out";
    document.body.appendChild(f);
    f.submit();
  };
  return (
    <Card aria-labelledby="data-title" data-testid="account-data" className="mt-6">
      <CardTitle id="data-title">Your data</CardTitle>
      <p className="mt-2 text-sm text-k-secondary">Download everything Klynge stores for your account, or delete it. Chart images are never stored.</p>
      <p className="mt-3 text-sm">
        <a href="/api/account/export" className="font-semibold text-k-lime" data-testid="export-link">
          Export my data (JSON)
        </a>
      </p>
      <form
        className="mt-4 grid gap-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          void del();
        }}
      >
        <label htmlFor={id} className="grid gap-1">
          <span className="text-xs font-semibold text-k-secondary">Type DELETE MY DATA to delete your account data</span>
          <input id={id} className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
        </label>
        <Button type="submit" disabled={confirm !== "DELETE MY DATA"}>
          Delete my data
        </Button>
      </form>
      <p aria-live="polite" className="mt-2 min-h-5 text-sm" data-testid="account-data-status">
        {msg}
      </p>
    </Card>
  );
}
