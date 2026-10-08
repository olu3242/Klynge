import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { EnrollmentStatus, FeedbackEntry, FeedbackTriage, OnboardingProgress, OpsAuditEntry, PilotEnrollment, PilotInvite, PilotStore } from "./types.ts";

/** In-process pilot store (tests, local dev, e2e). User methods are tenant-scoped; operator methods are explicit. */
export class MemoryPilotStore implements PilotStore {
  protected invites = new Map<string, PilotInvite>();
  protected enrollments = new Map<string, PilotEnrollment>();
  protected onboarding = new Map<string, OnboardingProgress>();
  protected feedback = new Map<string, FeedbackEntry>();
  protected triage = new Map<string, FeedbackTriage>();
  protected opsAudit: OpsAuditEntry[] = [];
  protected changed(): void {}
  private k = (t: string, id: string) => `${t}\u0000${id}`;

  async getInvite(email: string) {
    return this.invites.get(email.toLowerCase()) ?? null;
  }
  async getEnrollment(t: string) {
    return this.enrollments.get(t) ?? null;
  }
  async activate(e: PilotEnrollment) {
    if (this.enrollments.has(e.tenantId)) return false;
    this.enrollments.set(e.tenantId, e);
    this.changed();
    return true;
  }
  async getOnboarding(t: string) {
    return this.onboarding.get(t) ?? null;
  }
  async putOnboarding(t: string, p: OnboardingProgress) {
    this.onboarding.set(t, p);
    this.changed();
  }
  async addFeedback(f: FeedbackEntry) {
    const key = this.k(f.tenantId, f.feedbackId);
    if (this.feedback.has(key)) return false;
    this.feedback.set(key, f);
    this.changed();
    return true;
  }
  async listFeedback(t: string) {
    return [...this.feedback.values()].filter((f) => f.tenantId === t).sort((a, b) => a.at - b.at);
  }

  // ── Operator surface (in-process control plane only; hosted uses scripts/pilot-admin.ts) ─────────────────────
  invite(email: string, cohort: string, at: number): PilotInvite {
    const i = { email: email.toLowerCase(), cohort, invitedAt: at, revokedAt: null };
    this.invites.set(i.email, i);
    this.changed();
    return i;
  }
  revoke(email: string, at: number): boolean {
    const i = this.invites.get(email.toLowerCase());
    if (!i || i.revokedAt !== null) return false;
    this.invites.set(i.email, { ...i, revokedAt: at });
    this.changed();
    return true;
  }
  setStatus(tenantId: string, status: EnrollmentStatus, reason: string | null, at: number): PilotEnrollment | null {
    const e = this.enrollments.get(tenantId);
    if (!e) return null;
    const next = { ...e, status, statusReason: reason?.slice(0, 160) ?? null, statusChangedAt: at };
    this.enrollments.set(tenantId, next);
    this.changed();
    return next;
  }
  allInvites(): PilotInvite[] {
    return [...this.invites.values()].sort((a, b) => a.invitedAt - b.invitedAt);
  }
  allEnrollments(): PilotEnrollment[] {
    return [...this.enrollments.values()].sort((a, b) => a.activatedAt - b.activatedAt);
  }
  allOnboarding(): (OnboardingProgress & { tenantId: string })[] {
    return [...this.onboarding].map(([tenantId, p]) => ({ ...p, tenantId }));
  }
  allFeedback(): FeedbackEntry[] {
    return [...this.feedback.values()].sort((a, b) => a.at - b.at);
  }
  setTriage(t: FeedbackTriage): void {
    this.triage.set(this.k(t.tenantId, t.feedbackId), t);
    this.changed();
  }
  allTriage(): FeedbackTriage[] {
    return [...this.triage.values()];
  }
  appendOpsAudit(e: OpsAuditEntry): void {
    if (this.opsAudit.some((x) => x.auditId === e.auditId)) return;
    this.opsAudit.push(e);
    this.changed();
  }
  allOpsAudit(): OpsAuditEntry[] {
    return [...this.opsAudit].sort((a, b) => b.at - a.at);
  }
  /** Account deletion (in-process): remove every pilot row owned by the tenant. Operator audit is kept (no PII). */
  purgeTenant(tenantId: string): number {
    let n = 0;
    if (this.enrollments.delete(tenantId)) n++;
    if (this.onboarding.delete(tenantId)) n++;
    for (const [k, f] of this.feedback) if (f.tenantId === tenantId && this.feedback.delete(k)) n++;
    for (const [k, t] of this.triage) if (t.tenantId === tenantId && this.triage.delete(k)) n++;
    if (n) this.changed();
    return n;
  }
}

/** LOCAL DEV / E2E ONLY (restart certification). */
export class FilePilotStore extends MemoryPilotStore {
  private readonly file: string;
  constructor(file: string) {
    super();
    this.file = file;
    if (existsSync(file)) {
      const d = JSON.parse(readFileSync(file, "utf8")) as Record<string, never>;
      this.invites = new Map(d.invites ?? []);
      this.enrollments = new Map(d.enrollments ?? []);
      this.onboarding = new Map(d.onboarding ?? []);
      this.feedback = new Map(d.feedback ?? []);
      this.triage = new Map(d.triage ?? []);
      this.opsAudit = d.opsAudit ?? [];
    }
  }
  protected override changed(): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(`${this.file}.tmp`, JSON.stringify({ invites: [...this.invites], enrollments: [...this.enrollments], onboarding: [...this.onboarding], feedback: [...this.feedback], triage: [...this.triage], opsAudit: this.opsAudit }));
    renameSync(`${this.file}.tmp`, this.file);
  }
}
