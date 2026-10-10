import type { WorkflowInstance, WorkflowStatus } from "./types.ts";

const NEXT: Readonly<Record<WorkflowStatus, readonly WorkflowStatus[]>> = {
  CREATED: ["VALIDATING", "CANCELED"],
  VALIDATING: ["READY", "BLOCKED", "FAILED", "CANCELED"],
  READY: ["RUNNING", "CANCELED"],
  RUNNING: ["WAITING_EXTERNAL", "WAITING_HUMAN", "RETRY_SCHEDULED", "COMPLETED", "BLOCKED", "FAILED", "CANCELED"],
  WAITING_EXTERNAL: ["READY", "RETRY_SCHEDULED", "BLOCKED", "FAILED", "CANCELED"],
  WAITING_HUMAN: ["READY", "BLOCKED", "CANCELED"],
  RETRY_SCHEDULED: ["READY", "DEAD_LETTERED", "CANCELED"],
  COMPLETED: [],
  BLOCKED: [],
  FAILED: [],
  CANCELED: [],
  DEAD_LETTERED: [],
};
export type TransitionResult =
  | { kind: "APPLIED"; instance: WorkflowInstance }
  | { kind: "DUPLICATE"; instance: WorkflowInstance }
  | { kind: "REJECTED"; reason: string };

export function transitionWorkflow(
  instance: WorkflowInstance,
  command: {
    tenantId: string; eventId: string; expectedRevision: number;
    to: WorkflowStatus; atMs: number; actor: string; reason: string;
  },
): TransitionResult {
  if (instance.tenantId !== command.tenantId) return { kind: "REJECTED", reason: "TENANT_MISMATCH" };
  if (!command.eventId.trim() || !command.actor.trim() || !command.reason.trim()) return { kind: "REJECTED", reason: "INVALID_COMMAND" };
  if (instance.processedEventIds.includes(command.eventId)) return { kind: "DUPLICATE", instance };
  if (command.expectedRevision !== instance.revision) return { kind: "REJECTED", reason: "REVISION_CONFLICT" };
  if (!Number.isSafeInteger(command.atMs) || command.atMs < instance.updatedAtMs) return { kind: "REJECTED", reason: "INVALID_TIME" };
  if (!NEXT[instance.status].includes(command.to)) return { kind: "REJECTED", reason: "INVALID_TRANSITION" };
  const attempt = command.to === "RUNNING" ? instance.attempt + 1 : instance.attempt;
  if (attempt > instance.maxAttempts) return { kind: "REJECTED", reason: "RETRY_BUDGET_EXCEEDED" };
  return {
    kind: "APPLIED",
    instance: {
      ...instance, status: command.to, attempt, revision: instance.revision + 1,
      updatedAtMs: command.atMs,
      processedEventIds: [...instance.processedEventIds, command.eventId],
      audit: [...instance.audit, {
        eventId: command.eventId, from: instance.status, to: command.to,
        atMs: command.atMs, actor: command.actor, reason: command.reason,
      }],
    },
  };
}
