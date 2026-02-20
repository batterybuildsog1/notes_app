"use client";

import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { AGENTS, AGENT_GROUPS, type AgentConfig } from "@/lib/agents";

interface AgentBarProps {
  activeAgentId: string | null;
  onSelectAgent: (agentId: string | null) => void;
}

export function AgentBar({ activeAgentId, onSelectAgent }: AgentBarProps) {
  const grouped = AGENT_GROUPS.map((g) => ({
    ...g,
    agents: AGENTS.filter((a) => a.group === g.key),
  }));

  return (
    <ScrollArea className="w-full hidden md:block">
      <div className="flex items-center gap-1 px-3 py-1">
        {grouped.map((group, gi) => (
          <div key={group.key} className="flex items-center gap-1 shrink-0">
            {gi > 0 && (
              <span className="text-border mx-1 select-none">|</span>
            )}
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium mr-0.5 select-none">
              {group.label}
            </span>
            {group.agents.map((agent: AgentConfig) => (
              <button
                key={agent.id}
                onClick={() =>
                  onSelectAgent(activeAgentId === agent.id ? null : agent.id)
                }
                title={agent.description}
                className={`
                  shrink-0 px-2 py-0.5 rounded text-xs font-medium
                  transition-colors whitespace-nowrap
                  ${
                    activeAgentId === agent.id
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                  }
                `}
              >
                {agent.name}
              </button>
            ))}
          </div>
        ))}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}
