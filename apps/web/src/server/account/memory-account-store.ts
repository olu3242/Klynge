import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { UserRiskPolicy } from "../engine-core.ts";
import type { AccountStore, AuditEntry, NotificationPreferences, OutboxItem, PolicyVerdictRecord } from "./types.ts";

/** Durable-in-process account store (tests, local dev). Scoped by the server-derived tenant id on every call. */
export class MemoryAccountStore implements AccountStore {
  protected policies = new Map<string, UserRiskPolicy>();
  protected verdicts = new Map<string, PolicyVerdictRecord>();
  protected prefs = new Map<string, NotificationPreferences>();
  protected outbox = new Map<string, OutboxItem>();
  protected audit = new Map<string, AuditEntry>();
  protected changed(): void {}
  private k = (t: string, id: string) => `${t}\u0000${id}`;

  async getPolicy(t: string) {
    return this.policies.get(t) ?? null;
  }
  async putPolicy(t: string, p: UserRiskPolicy, _at?: number) {
    this.policies.set(t, p);
    this.changed();
  }
  async putVerdict(v: PolicyVerdictRecord) {
    const key = this.k(v.tenantId, v.recordId);
    if (this.verdicts.has(key)) return false;
    this.verdicts.set(key, v);
    this.changed();
    return true;
  }
  async listVerdicts(t: string) {
    return [...this.verdicts.values()].filter((v) => v.tenantId === t).sort((a, b) => a.at - b.at);
  }
  async getNotificationPrefs(t: string) {
    return this.prefs.get(t) ?? null;
  }
  async putNotificationPrefs(t: string, p: NotificationPreferences, _at?: number) {
    this.prefs.set(t, p);
    this.changed();
  }
  async enqueue(i: OutboxItem) {
    const key = this.k(i.tenantId, i.notificationId);
    if (this.outbox.has(key)) return false;
    this.outbox.set(key, i);
    this.changed();
    return true;
  }
  async updateOutbox(i: OutboxItem) {
    const key = this.k(i.tenantId, i.notificationId);
    if (!this.outbox.has(key)) throw new Error("outbox item not found");
    this.outbox.set(key, i);
    this.changed();
  }
  async listOutbox(t: string) {
    return [...this.outbox.values()].filter((i) => i.tenantId === t).sort((a, b) => a.createdAt - b.createdAt);
  }
  /** Infrastructure view (in-process dispatcher only). */
  allPendingTenants(): string[] {
    return [...new Set([...this.outbox.values()].filter((i) => i.status === "PENDING").map((i) => i.tenantId))];
  }
  async appendAudit(e: AuditEntry) {
    const key = this.k(e.tenantId, e.auditId);
    if (this.audit.has(key)) return false;
    this.audit.set(key, e);
    this.changed();
    return true;
  }
  async listAudit(t: string, limit = 100) {
    return [...this.audit.values()].filter((e) => e.tenantId === t).sort((a, b) => b.at - a.at).slice(0, limit);
  }
}

/** LOCAL DEV / E2E ONLY (restart certification). */
export class FileAccountStore extends MemoryAccountStore {
  private readonly file: string;
  constructor(file: string) {
    super();
    this.file = file;
    if (existsSync(file)) {
      const d = JSON.parse(readFileSync(file, "utf8")) as Record<string, [string, never][]>;
      this.policies = new Map(d.policies ?? []);
      this.verdicts = new Map(d.verdicts ?? []);
      this.prefs = new Map(d.prefs ?? []);
      this.outbox = new Map(d.outbox ?? []);
      this.audit = new Map(d.audit ?? []);
    }
  }
  protected override changed(): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(`${this.file}.tmp`, JSON.stringify({ policies: [...this.policies], verdicts: [...this.verdicts], prefs: [...this.prefs], outbox: [...this.outbox], audit: [...this.audit] }));
    renameSync(`${this.file}.tmp`, this.file);
  }
}
