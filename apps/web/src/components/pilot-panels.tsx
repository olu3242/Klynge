"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";

export interface OnboardingStepView {
  id: string;
  title: string;
  detail: string;
  done: boolean;
}
export interface OnboardingViewProps {
  steps: OnboardingStepView[];
  completed: number;
  complete: boolean;
  dismissed: boolean;
}

/** Guided onboarding (Batch 72). Progress is derived on the server from the user's own state. */
export function Onboarding({ initial }: { initial: OnboardingViewProps }) {
  const [v, setV] = useState(initial);
  const post = async (action: "acknowledge-evidence-modes" | "dismiss") => {
    const res = await fetch("/api/pilot/onboarding", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
    if (res.ok) setV((await res.json()) as OnboardingViewProps);
  };
  if (v.dismissed) return null;
  return (
    <Card aria-labelledby="onb-title" data-testid="onboarding" data-completed={v.completed} className="mb-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <CardTitle id="onb-title">Getting started · {v.completed}/{v.steps.length}</CardTitle>
        <Button size="sm" variant="subtle" onClick={() => void post("dismiss")}>
          Hide guide
        </Button>
      </div>
      <ol className="mt-3 grid gap-3 text-sm">
        {v.steps.map((s) => (
          <li key={s.id} data-step={s.id} data-done={String(s.done)} className="grid gap-1">
            <span className="font-semibold">
              <span aria-hidden="true">{s.done ? "✓ " : "○ "}</span>
              {s.title} <span className="sr-only">{s.done ? "(done)" : "(to do)"}</span>
            </span>
            <span className="text-k-secondary">{s.detail}</span>
            {s.id === "evidence-modes" && !s.done && (
              <span>
                <Button size="sm" onClick={() => void post("acknowledge-evidence-modes")}>
                  I understand evidence modes
                </Button>
              </span>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}

const RATINGS = ["clarity", "confidence", "usability", "usefulness"] as const;
const LABEL: Record<(typeof RATINGS)[number], string> = { clarity: "Clarity of the explanation", confidence: "My confidence in what I saw", usability: "Ease of use", usefulness: "Usefulness" };

/** Structured feedback (Batch 74). It is a report about the product — it never changes a decision. */
export function FeedbackForm({ recordId }: { recordId: string | null }) {
  const ids = { missing: useId(), cat: useId(), desc: useId(), r: useId() };
  const [ratings, setRatings] = useState<Record<string, string>>({});
  const [missing, setMissing] = useState("");
  const [category, setCategory] = useState("OTHER");
  const [desc, setDesc] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const send = async () => {
    setMsg(null);
    const res = await fetch("/api/pilot/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recordId, ratings: Object.fromEntries(Object.entries(ratings).filter(([, x]) => x).map(([k, x]) => [k, Number(x)])), missingInformation: missing, problem: desc.trim() ? { category, description: desc } : null }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) return setMsg(body.error ?? "Could not send feedback");
    setRatings({});
    setMissing("");
    setDesc("");
    setMsg("Thank you — feedback recorded. It is reviewed by the pilot team and never changes a decision.");
  };
  return (
    <Card aria-labelledby="fb-title" data-testid="feedback" className="mt-6">
      <CardTitle id="fb-title">Pilot feedback</CardTitle>
      <form
        className="mt-3 grid gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <div className="grid gap-2 sm:grid-cols-2">
          {RATINGS.map((k) => (
            <label key={k} htmlFor={`${ids.r}-${k}`} className="grid gap-1">
              <span className="text-xs font-semibold text-k-secondary">{LABEL[k]}</span>
              <select id={`${ids.r}-${k}`} className="input" value={ratings[k] ?? ""} onChange={(e) => setRatings({ ...ratings, [k]: e.target.value })}>
                <option value="">Not rated</option>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <label htmlFor={ids.missing} className="grid gap-1">
          <span className="text-xs font-semibold text-k-secondary">What information was missing?</span>
          <textarea id={ids.missing} className="input min-h-16" maxLength={500} value={missing} onChange={(e) => setMissing(e.target.value)} />
        </label>
        <div className="grid gap-2 sm:grid-cols-[12rem_minmax(0,1fr)]">
          <label htmlFor={ids.cat} className="grid gap-1">
            <span className="text-xs font-semibold text-k-secondary">Problem area</span>
            <select id={ids.cat} className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
              {["DATA", "CHART_READING", "DECISION_EXPLANATION", "ALERTS", "ACCOUNT", "OTHER"].map((c) => (
                <option key={c} value={c}>
                  {c.replace("_", " ").toLowerCase()}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor={ids.desc} className="grid gap-1">
            <span className="text-xs font-semibold text-k-secondary">Report a problem (optional)</span>
            <textarea id={ids.desc} className="input min-h-16" maxLength={1000} value={desc} onChange={(e) => setDesc(e.target.value)} />
          </label>
        </div>
        <div>
          <Button type="submit">Send feedback</Button>
        </div>
        <p aria-live="polite" className="min-h-5" data-testid="feedback-status">
          {msg}
        </p>
      </form>
    </Card>
  );
}
