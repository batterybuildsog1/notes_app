import agentsData from "@/config/agents.json";

export type AgentGroup = "core" | "platform" | "techridge" | "swarm";

export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  source: string; // matches note.source field
  group: AgentGroup;
  projectId?: string; // canonical swarm ID (TR-1.0, etc.) for TR agents
  model?: string;
  telegramBot?: string; // telegram account ID from openclaw bindings
}

export const AGENT_GROUPS: { key: AgentGroup; label: string }[] = [
  { key: "core", label: "Core" },
  { key: "platform", label: "Platform" },
  { key: "techridge", label: "TechRidge" },
  { key: "swarm", label: "Swarm" },
];

export const AGENTS: AgentConfig[] = agentsData as AgentConfig[];

export function getAgentById(id: string): AgentConfig | undefined {
  return AGENTS.find((a) => a.id === id);
}

export function getAgentBySource(source: string): AgentConfig | undefined {
  return AGENTS.find((a) => a.source === source);
}

export function getAgentsByGroup(group: AgentGroup): AgentConfig[] {
  return AGENTS.filter((a) => a.group === group);
}
