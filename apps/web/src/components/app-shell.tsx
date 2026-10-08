import type { ReactNode } from "react";
import { COMPACT_RISK_NOTICE } from "@/lib/notices";

export function AppShell({ children, active }: { children: ReactNode; active: "workspace" | "history" }) {
  const link = (href: string, label: string, key: string) => (
    <a href={href} aria-current={active === key ? "page" : undefined} className={active === key ? "text-k-text" : "text-k-secondary hover:text-k-text"}>
      {label}
    </a>
  );
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-k-border bg-k-black/85 backdrop-blur">
        <nav aria-label="Workspace" className="mx-auto flex min-h-14 max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2 sm:px-6">
          <a href="/app" className="shrink-0" aria-label="Klynge workspace">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/klynge-logo-dark.svg" alt="Klynge" width={110} height={29} className="h-7 w-auto" />
          </a>
          <div className="ml-auto flex gap-5 text-sm">
            {link("/app", "Workspace", "workspace")}
            {link("/app/history", "History", "history")}
          </div>
        </nav>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
      <footer className="mx-auto max-w-6xl px-4 pb-10 text-xs text-k-secondary sm:px-6">
        <p role="note">
          <strong className="text-k-text">Klynge is not financial advice.</strong> {COMPACT_RISK_NOTICE.replace("Klynge is not financial advice. ", "")}
        </p>
      </footer>
    </>
  );
}
