export interface Checkpoint {
  tenantId: string; workflowId: string; stepId: string; revision: number;
  evidenceIds: readonly string[]; outputHash: string; completedAtMs: number;
}
export function validateCheckpoint(c: Checkpoint): boolean {
  return Boolean(c.tenantId.trim() && c.workflowId.trim() && c.stepId.trim() &&
    /^[0-9a-f]{64}$/.test(c.outputHash) && Number.isSafeInteger(c.revision) &&
    c.revision >= 0 && Number.isSafeInteger(c.completedAtMs) &&
    c.completedAtMs >= 0 && c.evidenceIds.every(id => id.length > 0 && id.length <= 128));
}
