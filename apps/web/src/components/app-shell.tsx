import type { ReactNode } from "react";
import { COMPACT_RISK_NOTICE, WORKSPACE_DISCLOSURE } from "@/lib/notices";

export interface ShellAccount {
  email: string | null;
  authEnabled: boolean;
  operator?: boolean;
}

export function AppShell({ children, active, account }: { children: ReactNode; active: "workspace" | "history" | "sign-in" | "settings" | "status" | "ops" | "pilot"; account?: ShellAccount }) {
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
          <div className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            {link("/app", "Workspace", "workspace")}
            {link("/app/history", "History", "history")}
            {account?.email && link("/app/settings", "Settings", "settings")}
            {account?.email && link("/app/status", "Status", "status")}
            {account?.operator && link("/app/ops", "Operations", "ops")}
            {account?.email ? (
              <form method="post" action="/auth/sign-out" className="flex items-center gap-3">
                <span className="max-w-[12rem] truncate text-k-secondary" data-testid="account-email">
                  {account.email}
                </span>
                <button className="rounded-lg border border-k-border px-3 py-1 font-semibold hover:border-k-lime">Sign out</button>
              </form>
            ) : account?.authEnabled ? (
              <a href="/sign-in" className="rounded-lg bg-k-lime px-3 py-1 font-semibold text-k-black hover:bg-k-lime-bright">
                Sign in
              </a>
            ) : null}
          </div>
        </nav>
        <p role="note" data-testid="risk-banner" className="border-t border-k-warning/30 bg-k-warning/5 px-4 py-1.5 text-center text-xs text-k-text sm:px-6">
          <span aria-hidden="true">⚠ </span>
          {WORKSPACE_DISCLOSURE}
        </p>
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
