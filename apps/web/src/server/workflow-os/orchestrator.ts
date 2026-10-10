import { transitionWorkflow } from "./state-machine.ts";
import type { WorkflowInstance, WorkflowStatus } from "./types.ts";

/** Storage-agnostic orchestration. Implementations MUST provide atomic compare-and-swap.
 * An in-memory adapter is for tests only, never multi-worker production use.
 */
export interface WorkflowStore {
  get(tenantId: string, workflowId: string): Promise<WorkflowInstance | null>;
  insert(instance: WorkflowInstance): Promise<boolean>;
  compareAndSwap(expectedRevision: number, instance: WorkflowInstance): Promise<boolean>;
}

export class WorkflowOrchestrator {
  constructor(private readonly store: WorkflowStore) {}

  async create(input: {
    workflowId: string; tenantId: string; definitionId: string;
    definitionVersion: number; maxAttempts: number; nowMs: number;
  }): Promise<WorkflowInstance> {
    if (!input.workflowId.trim() || !input.tenantId.trim() || !input.definitionId.trim() ||
      !Number.isSafeInteger(input.definitionVersion) || input.definitionVersion < 1 ||
      !Number.isSafeInteger(input.maxAttempts) || input.maxAttempts < 1 ||
      !Number.isSafeInteger(input.nowMs) || input.nowMs < 0) throw new Error("INVALID_WORKFLOW");
    const instance: WorkflowInstance = {
      ...input, createdAtMs: input.nowMs, updatedAtMs: input.nowMs,
      status: "CREATED", revision: 0, attempt: 0, processedEventIds: [], audit: [],
    };
    if (!(await this.store.insert(instance))) throw new Error("WORKFLOW_ALREADY_EXISTS");
    return instance;
  }

  async transition(input: {
    tenantId: string; workflowId: string; eventId: string;
    expectedRevision: number; to: WorkflowStatus; atMs: number;
    actor: string; reason: string;
  }) {
    const current = await this.store.get(input.tenantId, input.workflowId);
    if (!current) return { kind: "REJECTED" as const, reason: "NOT_FOUND" };
    const result = transitionWorkflow(current, input);
    if (result.kind !== "APPLIED") return result;
    const saved = await this.store.compareAndSwap(current.revision, result.instance);
    if (!saved) return { kind: "REJECTED" as const, reason: "CONCURRENT_UPDATE" };
    return result;
  }
}
