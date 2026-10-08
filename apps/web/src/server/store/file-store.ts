import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MemorySessionStore } from "./memory-store.ts";

/**
 * LOCAL DEV / E2E ONLY: the memory store persisted to a JSON file so a process restart resumes from durable state
 * (runtime restart certification). Not a production store — use Supabase (RLS) for real users.
 */
export class FileSessionStore extends MemorySessionStore {
  private readonly file: string;
  constructor(file: string) {
    super();
    this.file = file;
    if (existsSync(file)) {
      const d = JSON.parse(readFileSync(file, "utf8")) as Record<string, [string, never][]>;
      this.sessions = new Map(d.sessions ?? []);
      this.records = new Map(d.records ?? []);
      this.alerts = new Map(d.alerts ?? []);
      this.journal = new Map(d.journal ?? []);
      this.runtime = new Map(d.runtime ?? []);
    }
  }
  protected override changed(): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ sessions: [...this.sessions], records: [...this.records], alerts: [...this.alerts], journal: [...this.journal], runtime: [...this.runtime] }));
    renameSync(tmp, this.file);
  }
}
