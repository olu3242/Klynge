/**
 * Canonical Klynge agent registry. Names and identifiers are fixed; see AGENTS.md.
 * No agent is implemented in market-truth-v1 — this registry defines identity and authority only.
 */
export const AGENT_IDS = [
  "marketAgent",
  "contextAgent",
  "structureAgent",
  "levelsAgent",
  "confirmationAgent",
  "riskAgent",
  "optionsAgent",
  "explainabilityAgent",
  "replayAgent",
  "journalAgent",
  "alertAgent",
] as const;

export type AgentId = (typeof AGENT_IDS)[number];

export interface AgentDefinition {
  id: AgentId;
  name: string;
  responsibility: string;
}

export const AGENTS: Readonly<Record<AgentId, Readonly<AgentDefinition>>> = Object.freeze({
  marketAgent: { id: "marketAgent", name: "Klynge Market Agent", responsibility: "Coordinates the other agents around a deterministic market-truth snapshot." },
  contextAgent: { id: "contextAgent", name: "Klynge Context Agent", responsibility: "Explains regime and data-quality state." },
  structureAgent: { id: "structureAgent", name: "Klynge Structure Agent", responsibility: "Explains confirmed swing structure." },
  levelsAgent: { id: "levelsAgent", name: "Klynge Levels Agent", responsibility: "Explains engine-computed levels (setup engine)." },
  confirmationAgent: { id: "confirmationAgent", name: "Klynge Confirmation Agent", responsibility: "Explains confirmation progress (setup engine)." },
  riskAgent: { id: "riskAgent", name: "Klynge Risk Agent", responsibility: "Explains blockers, invalidation and risk context." },
  optionsAgent: { id: "optionsAgent", name: "Klynge Options Agent", responsibility: "Explains engine-selected options context (future)." },
  explainabilityAgent: { id: "explainabilityAgent", name: "Klynge Explainability Agent", responsibility: "Translates reasons/blockers into plain language." },
  replayAgent: { id: "replayAgent", name: "Klynge Replay Agent", responsibility: "Walks through historical no-lookahead replays." },
  journalAgent: { id: "journalAgent", name: "Klynge Journal Agent", responsibility: "Summarizes user journal entries against recorded engine state." },
  alertAgent: { id: "alertAgent", name: "Klynge Alert Agent", responsibility: "Surfaces deterministic state changes (future)." },
});
