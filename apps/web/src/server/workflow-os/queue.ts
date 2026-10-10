/** Pure queue lease and retry policy. Persistence and atomic claiming belong to the SQL adapter. */
export type JobStatus = "PENDING" | "LEASED" | "SUCCEEDED" | "DEAD_LETTERED";
export interface WorkflowJob {
  jobId: string;
  tenantId: string;
  workflowId: string;
  status: JobStatus;
  attempt: number;
  maxAttempts: number;
  dueAtMs: number;
  leaseOwner: string | null;
  leaseUntilMs: number | null;
  fencingToken: number;
}
export type JobResult = { kind: "APPLIED"; job: WorkflowJob } | { kind: "REJECTED"; reason: string };
export function leaseJob(job: WorkflowJob, worker: string, nowMs: number, durationMs: number): JobResult {
  if (!worker.trim() || !Number.isSafeInteger(nowMs) || !Number.isSafeInteger(durationMs) ||
    durationMs < 1000 || durationMs > 900000) return { kind: "REJECTED", reason: "INVALID_LEASE" };
  if (job.status !== "PENDING" && !(job.status === "LEASED" && (job.leaseUntilMs ?? Infinity) <= nowMs))
    return { kind: "REJECTED", reason: "NOT_CLAIMABLE" };
  if (job.dueAtMs > nowMs) return { kind: "REJECTED", reason: "NOT_DUE" };
  if (job.attempt >= job.maxAttempts) return { kind: "REJECTED", reason: "ATTEMPTS_EXHAUSTED" };
  return { kind: "APPLIED", job: {
    ...job, status: "LEASED", attempt: job.attempt + 1,
    leaseOwner: worker, leaseUntilMs: nowMs + durationMs, fencingToken: job.fencingToken + 1,
  } };
}
export function finishJob(job: WorkflowJob, worker: string, token: number, nowMs: number, succeeded: boolean): JobResult {
  if (job.status !== "LEASED" || job.leaseOwner !== worker || job.fencingToken !== token ||
    !Number.isSafeInteger(nowMs) || nowMs >= (job.leaseUntilMs ?? -1))
    return { kind: "REJECTED", reason: "LEASE_LOST" };
  if (succeeded) return { kind: "APPLIED", job: { ...job, status: "SUCCEEDED", leaseOwner: null, leaseUntilMs: null } };
  const exhausted = job.attempt >= job.maxAttempts;
  const delayMs = Math.min(600000, 1000 * 2 ** Math.min(job.attempt - 1, 9));
  return { kind: "APPLIED", job: {
    ...job, status: exhausted ? "DEAD_LETTERED" : "PENDING",
    dueAtMs: exhausted ? job.dueAtMs : nowMs + delayMs,
    leaseOwner: null, leaseUntilMs: null,
  } };
}
