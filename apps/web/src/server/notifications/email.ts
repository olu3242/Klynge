/** Email delivery adapters. The API key is server-only and never logged. */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  idempotencyKey: string;
}

export interface EmailProvider {
  readonly id: string;
  send(m: EmailMessage): Promise<{ ok: true; providerMessageId: string } | { ok: false; retryable: boolean; error: string }>;
}

/** Test/dev provider: records messages in memory (exposed to e2e only in test mode). */
export class MockEmailProvider implements EmailProvider {
  readonly id = "mock-email";
  readonly sent: EmailMessage[] = [];
  failNext = 0;
  async send(m: EmailMessage) {
    if (this.failNext > 0) {
      this.failNext--;
      return { ok: false as const, retryable: true, error: "simulated outage" };
    }
    if (this.sent.some((x) => x.idempotencyKey === m.idempotencyKey)) return { ok: true as const, providerMessageId: `dup:${m.idempotencyKey}` };
    this.sent.push(m);
    return { ok: true as const, providerMessageId: `mock:${this.sent.length}` };
  }
}

/** Resend HTTP adapter (POST /emails, Idempotency-Key header). */
export class ResendEmailProvider implements EmailProvider {
  readonly id = "resend";
  private readonly apiKey: string;
  private readonly from: string;
  private readonly fetchImpl: typeof fetch;
  constructor(cfg: { apiKey: string; from: string; fetch?: typeof fetch }) {
    if (!cfg.apiKey || !cfg.from) throw new Error("resend: RESEND_API_KEY and KLYNGE_EMAIL_FROM are required (server-only)");
    this.apiKey = cfg.apiKey;
    this.from = cfg.from;
    this.fetchImpl = cfg.fetch ?? fetch;
  }
  async send(m: EmailMessage) {
    let res: Response;
    try {
      res = await this.fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": m.idempotencyKey },
        body: JSON.stringify({ from: this.from, to: [m.to], subject: m.subject, text: m.text }),
      });
    } catch {
      return { ok: false as const, retryable: true, error: "email provider unreachable" };
    }
    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as { id?: string };
      return { ok: true as const, providerMessageId: body.id ?? "unknown" };
    }
    return { ok: false as const, retryable: res.status === 429 || res.status >= 500, error: `email provider error ${res.status}` };
  }
}
