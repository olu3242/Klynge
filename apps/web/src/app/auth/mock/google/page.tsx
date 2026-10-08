import { notFound } from "next/navigation";
import { authMode } from "@/server/auth/select";

export const dynamic = "force-dynamic";

/** TEST MODE ONLY: stands in for Google's consent screen in offline e2e. 404 unless KLYNGE_AUTH=mock. */
export default async function MockGoogleConsent({ searchParams }: { searchParams: Promise<{ redirect_to?: string }> }) {
  if (authMode() !== "mock") notFound();
  const { redirect_to } = await searchParams;
  return (
    <main id="main" className="mx-auto grid max-w-md gap-4 px-4 py-16">
      <h1 className="text-2xl font-bold">Mock Google sign-in (test mode)</h1>
      <form method="post" action="/auth/mock/google/approve" className="grid gap-3">
        <input type="hidden" name="redirect_to" value={redirect_to ?? ""} />
        <label htmlFor="mock-email" className="text-sm font-semibold">
          Google account email
        </label>
        <input id="mock-email" name="email" type="email" required className="input" />
        <button className="min-h-10 rounded-lg bg-k-lime px-4 font-semibold text-k-black">Continue</button>
      </form>
    </main>
  );
}
