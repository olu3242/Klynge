/** Workflow OS v1 contracts. Runtime authority remains server-side.
 * This is a deterministic state model, not a durable queue or live agent executor.
 */
export type WorkflowStatus =
  | "CREATED" | "VALIDATING" | "READY" | "RUNNING"
  | "WAITING_EXTERNAL" | "WAITING_HUMAN" | "RETRY_SCHEDULED"
  | "COMPLETED" | "BLOCKED" | "FAILED" | "CANCELED" | "DEAD_LETTERED";

export type WorkflowEvent = Readonly<{
  eventId: string;
  tenantId: string;
  workflowId: string;
  eventType: string;
  idempotencyKey: string;
  occurredAtMs: number;
  evidenceIds: readonly string[];
}>;

export type WorkflowInstance = Readonly<{
  workflowId: string;
  tenantId: string;
  definitionId: string;
  definitionVersion: number;
  status: WorkflowStatus;
  revision: number;
  attempt: number;
  maxAttempts: number;
  createdAtMs: number;
  updatedAtMs: number;
  processedEventIds: readonly string[];
  audit: readonly WorkflowTransition[];
}>;

export type WorkflowTransition = Readonly<{
  eventId: string;
  from: WorkflowStatus;
  to: WorkflowStatus;
  atMs: number;
  actor: string;
  reason: string;
}>;
