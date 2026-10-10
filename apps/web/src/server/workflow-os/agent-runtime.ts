/** Agent execution is capability-limited and cannot place brokerage orders.
 * All capabilities must be explicitly registered server-side.
 */
export type AgentCapability =
  | "market.read" | "chart.extract" | "structure.evaluate"
  | "risk.evaluate" | "notification.prepare" | "journal.append";
export interface AgentDefinition {
  id: string;
  version: number;
  capabilities: readonly AgentCapability[];
  maxRuntimeMs: number;
}
export interface AgentRequest {
  tenantId: string;
  workflowId: string;
  agentId: string;
  capability: AgentCapability;
  evidenceIds: readonly string[];
}
export type AgentVerdict =
  | { kind: "AUTHORIZED"; agent: AgentDefinition }
  | { kind: "DENIED"; reason: string };
export function authorizeAgent(
  registry: ReadonlyMap<string, AgentDefinition>,
  request: AgentRequest,
  allowedCapabilities: ReadonlySet<AgentCapability>,
): AgentVerdict {
  if (!request.tenantId.trim() || !request.workflowId.trim() ||
      !request.agentId.trim()) return { kind: "DENIED", reason: "INVALID_CONTEXT" };
  const agent = registry.get(request.agentId);
  if (!agent || agent.version < 1 || agent.maxRuntimeMs < 1 || agent.maxRuntimeMs > 300000)
    return { kind: "DENIED", reason: "UNKNOWN_OR_INVALID_AGENT" };
  if (!agent.capabilities.includes(request.capability) || !allowedCapabilities.has(request.capability))
    return { kind: "DENIED", reason: "CAPABILITY_DENIED" };
  if (request.evidenceIds.some(id => !id.trim())) return { kind: "DENIED", reason: "INVALID_EVIDENCE" };
  return { kind: "AUTHORIZED", agent };
}
