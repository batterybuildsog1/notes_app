"use client";

import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { AGENTS, type AgentConfig } from "@/lib/agents";

interface AgentBarProps {
  activeAgentId: string | null;
  onSelectAgent: (agentId: string | null) => void;
}

export function AgentBar({ activeAgentId, onSelectAgent }: AgentBarProps) {
  return (
    <ScrollArea className="w-full">
      <div className="flex items-center gap-2 px-3 py-1">
        {AGENTS.map((agent) => (
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
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}
