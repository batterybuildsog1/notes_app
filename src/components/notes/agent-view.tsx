"use client";

import { useState, useEffect, useMemo } from "react";
import { FileText, Bot, MessageCircle, Cpu, FolderOpen, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { AgentConfig } from "@/lib/agents";
import { AGENTS, AGENT_GROUPS } from "@/lib/agents";
import type { NoteWithEntities } from "@/lib/db";
import { relativeTime } from "@/lib/utils";

const GROUP_COLORS: Record<string, string> = {
  core: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  platform: "bg-purple-500/10 text-purple-600 border-purple-500/20",
  techridge: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  swarm: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
};

const CATEGORY_COLORS: Record<string, string> = {
  "artifact:decision": "bg-amber-500/10 text-amber-600 border-amber-500/20",
  "artifact:status": "bg-cyan-500/10 text-cyan-600 border-cyan-500/20",
  "artifact:conflict": "bg-red-500/10 text-red-600 border-red-500/20",
  "artifact:activity": "bg-gray-500/10 text-gray-600 border-gray-500/20",
  "artifact:note": "bg-blue-500/10 text-blue-600 border-blue-500/20",
  "artifact:summary": "bg-green-500/10 text-green-600 border-green-500/20",
  "artifact:file-change": "bg-purple-500/10 text-purple-600 border-purple-500/20",
};

interface AgentViewProps {
  agent: AgentConfig;
  onSelectNote: (noteId: string) => void;
}

export function AgentView({ agent, onSelectNote }: AgentViewProps) {
  const [notes, setNotes] = useState<NoteWithEntities[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/notes?source=${encodeURIComponent(agent.source)}&limit=100`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) {
          setNotes(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [agent.source]);

  const groupLabel = AGENT_GROUPS.find((g) => g.key === agent.group)?.label ?? agent.group;
  const groupColor = GROUP_COLORS[agent.group] ?? "";

  // Last activity from most recent note
  const lastActivity = useMemo(() => {
    if (notes.length === 0) return null;
    const latest = notes[0];
    return latest.display_updated_at || latest.updated_at;
  }, [notes]);

  // Linked projects for this agent (from the agent config)
  const linkedProjects = useMemo(() => {
    if (agent.projectId) return [agent.projectId];
    return [];
  }, [agent.projectId]);

  return (
    <div className="h-full overflow-y-auto">
      {/* Agent header */}
      <div className="border-b px-6 py-5">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">{agent.name}</h1>
          <Badge variant="outline" className={`text-[10px] ${groupColor}`}>
            {groupLabel}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground mt-1">{agent.description}</p>

        {/* Metadata row */}
        <div className="flex flex-wrap items-center gap-3 mt-3 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <FileText className="h-3.5 w-3.5" />
            {loading ? "..." : notes.length} notes
          </span>
          {agent.model && (
            <span className="flex items-center gap-1">
              <Cpu className="h-3.5 w-3.5" />
              {agent.model}
            </span>
          )}
          {linkedProjects.length > 0 && linkedProjects.map((pid) => (
            <span key={pid} className="flex items-center gap-1">
              <FolderOpen className="h-3.5 w-3.5" />
              {pid}
            </span>
          ))}
          {agent.telegramBot && (
            <a
              href={`https://t.me/${agent.telegramBot.replace('-bot', '_bot')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 hover:text-foreground transition-colors"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              Telegram
            </a>
          )}
          {lastActivity && (
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              Last active {relativeTime(lastActivity)}
            </span>
          )}
        </div>
      </div>

      {/* Notes list */}
      <div className="px-4 py-3">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            Loading...
          </div>
        ) : notes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
            <Bot className="h-10 w-10 opacity-20" />
            <p>No notes from this agent yet</p>
          </div>
        ) : (
          <div className="space-y-1">
            {notes.map((note) => {
              const isArtifact = note.category?.startsWith("artifact:");
              const categoryColor = note.category ? (CATEGORY_COLORS[note.category] || "") : "";

              return (
                <button
                  key={note.id}
                  onClick={() => onSelectNote(note.id)}
                  className="w-full text-left px-3 py-3 rounded-lg hover:bg-accent/50 transition-colors group"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm truncate">
                        {note.title || "Untitled"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {(note.content || "").slice(0, 150)}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0 mt-0.5">
                      {relativeTime(note.display_updated_at || note.updated_at)}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {isArtifact && categoryColor && (
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${categoryColor}`}>
                        {note.category?.replace("artifact:", "")}
                      </Badge>
                    )}
                    {note.tags && note.tags.slice(0, 4).map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
