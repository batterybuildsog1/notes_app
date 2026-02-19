export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  source: string; // matches note.source field
}

export const AGENTS: AgentConfig[] = [
  { id: "pm", name: "PM", description: "Chief of Staff", source: "pm-agent" },
  { id: "notes-pm", name: "Notes PM", description: "Knowledge base health", source: "notes-pm" },
  { id: "finance", name: "Finance", description: "Financial exports", source: "finance-agent" },
  { id: "coder", name: "Coder", description: "Code generation", source: "coder" },
  { id: "cleanup", name: "Cleanup", description: "Code cleanup", source: "cleanup" },
];

export function getAgentById(id: string): AgentConfig | undefined {
  return AGENTS.find((a) => a.id === id);
}

export function getAgentBySource(source: string): AgentConfig | undefined {
  return AGENTS.find((a) => a.source === source);
}
