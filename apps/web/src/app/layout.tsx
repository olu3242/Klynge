import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Klynge — Workspace",
  description: "Klynge market-risk workspace. Klynge is not financial advice.",
  icons: { icon: "/favicon.svg" },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:rounded-md focus:bg-k-lime focus:px-3 focus:py-2 focus:text-k-black">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
