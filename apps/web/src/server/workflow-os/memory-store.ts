import type { WorkflowInstance } from "./types.ts";
import type { WorkflowStore } from "./orchestrator.ts";

/** Isolated single-process test adapter. Not suitable for production workers. */
export class MemoryWorkflowStore implements WorkflowStore {
  private readonly rows = new Map<string, WorkflowInstance>();
  private key(tenantId: string, workflowId: string) { return JSON.stringify([tenantId, workflowId]); }
  async get(tenantId: string, workflowId: string) {
    return this.rows.get(this.key(tenantId, workflowId)) ?? null;
  }
  async insert(instance: WorkflowInstance) {
    const key = this.key(instance.tenantId, instance.workflowId);
    if (this.rows.has(key)) return false;
    this.rows.set(key, instance);
    return true;
  }
  async compareAndSwap(expectedRevision: number, instance: WorkflowInstance) {
    const key = this.key(instance.tenantId, instance.workflowId);
    const current = this.rows.get(key);
    if (!current || current.revision !== expectedRevision ||
      instance.revision !== expectedRevision + 1) return false;
    this.rows.set(key, instance);
    return true;
  }
}
