"use client";

import { useState, useEffect, useMemo } from "react";
import { FileText, Users, Building2, Bot, Hash, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { getAgentBySource } from "@/lib/agents";
import type { NoteWithEntities, ProjectWithCounts } from "@/lib/db";
import { relativeTime } from "@/lib/utils";

const SOURCE_COLORS: Record<string, string> = {
  "pm-agent": "bg-blue-500/10 text-blue-600 border-blue-500/20",
  "notes-pm": "bg-indigo-500/10 text-indigo-600 border-indigo-500/20",
  "swarm-orch": "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  "swarm-project": "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  "swarm-finance": "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  "swarm-portfolio": "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
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

function NoteListItem({ note, onSelectNote }: { note: NoteWithEntities; onSelectNote: (id: string) => void }) {
  const agent = note.source ? getAgentBySource(note.source) : null;
  const sourceColor = note.source ? (SOURCE_COLORS[note.source] || "bg-muted text-muted-foreground") : "";
  const categoryColor = note.category ? (CATEGORY_COLORS[note.category] || "") : "";
  const isArtifact = note.category?.startsWith("artifact:");

  return (
    <button
      onClick={() => onSelectNote(note.id)}
      className="w-full text-left px-3 py-3 rounded-lg hover:bg-accent/50 transition-colors group"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="font-medium text-sm truncate">
              {note.title || "Untitled"}
            </p>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
            {(note.content || "").slice(0, 150)}
          </p>
        </div>
        <span className="text-xs text-muted-foreground shrink-0 mt-0.5">
          {relativeTime(note.display_updated_at || note.updated_at)}
        </span>
      </div>
      <div className="flex flex-wrap gap-1 mt-1.5">
        {agent && (
          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${sourceColor}`}>
            <Bot className="h-2.5 w-2.5 mr-0.5" />
            {agent.name}
          </Badge>
        )}
        {isArtifact && categoryColor && (
          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${categoryColor}`}>
            {note.category?.replace("artifact:", "")}
          </Badge>
        )}
        {note.tags && note.tags.slice(0, 3).map((tag) => (
          <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0">
            {tag}
          </Badge>
        ))}
      </div>
    </button>
  );
}

interface ProjectViewProps {
  project: ProjectWithCounts;
  onSelectNote: (noteId: string) => void;
}

export function ProjectView({ project, onSelectNote }: ProjectViewProps) {
  const [notes, setNotes] = useState<NoteWithEntities[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/notes?project=${project.id}&limit=200`)
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
  }, [project.id]);

  // Split notes into categories
  const allNotes = notes;
  const decisions = useMemo(
    () => notes.filter((n) => n.category === "artifact:decision"),
    [notes]
  );
  const statusNotes = useMemo(
    () => notes.filter((n) => n.category === "artifact:status"),
    [notes]
  );
  const regularNotes = useMemo(
    () => notes.filter((n) => !n.category?.startsWith("artifact:")),
    [notes]
  );

  // Collect all unique people and companies across notes
  const allPeople = new Map<string, string>();
  const allCompanies = new Map<string, string>();
  for (const note of notes) {
    note.people?.forEach((p) => allPeople.set(p.id, p.name));
    note.companies?.forEach((c) => allCompanies.set(c.id, c.name));
  }

  // Determine active tab based on data
  const hasDecisions = decisions.length > 0;
  const hasStatus = statusNotes.length > 0;
  const hasPeople = allPeople.size > 0 || allCompanies.size > 0;

  return (
    <div className="h-full overflow-y-auto">
      {/* Project header */}
      <div className="border-b px-6 py-5">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">{project.name}</h1>
          {(project as ProjectWithCounts & { external_id?: string }).external_id && (
            <Badge variant="outline" className="text-xs font-mono">
              {(project as ProjectWithCounts & { external_id?: string }).external_id}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <FileText className="h-3.5 w-3.5" />
            {allNotes.length} notes
          </span>
          {hasDecisions && (
            <span className="flex items-center gap-1">
              <Hash className="h-3.5 w-3.5" />
              {decisions.length} decisions
            </span>
          )}
          {allPeople.size > 0 && (
            <span className="flex items-center gap-1">
              <Users className="h-3.5 w-3.5" />
              {allPeople.size} people
            </span>
          )}
          {allCompanies.size > 0 && (
            <span className="flex items-center gap-1">
              <Building2 className="h-3.5 w-3.5" />
              {allCompanies.size} companies
            </span>
          )}
        </div>
      </div>

      {/* Tabbed content */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          Loading...
        </div>
      ) : allNotes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
          <FileText className="h-10 w-10 opacity-20" />
          <p>No notes linked to this project</p>
        </div>
      ) : (
        <Tabs defaultValue="notes" className="px-4 py-3">
          <TabsList>
            <TabsTrigger value="notes">
              Notes {regularNotes.length > 0 && `(${regularNotes.length})`}
            </TabsTrigger>
            {hasDecisions && (
              <TabsTrigger value="decisions">
                Decisions ({decisions.length})
              </TabsTrigger>
            )}
            {hasStatus && (
              <TabsTrigger value="status">
                Status ({statusNotes.length})
              </TabsTrigger>
            )}
            {hasPeople && (
              <TabsTrigger value="people">
                People
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="notes" className="mt-2">
            <div className="space-y-1">
              {regularNotes.map((note) => (
                <NoteListItem key={note.id} note={note} onSelectNote={onSelectNote} />
              ))}
              {regularNotes.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No regular notes yet
                </p>
              )}
            </div>
          </TabsContent>

          {hasDecisions && (
            <TabsContent value="decisions" className="mt-2">
              <div className="space-y-1">
                {decisions.map((note) => (
                  <NoteListItem key={note.id} note={note} onSelectNote={onSelectNote} />
                ))}
              </div>
            </TabsContent>
          )}

          {hasStatus && (
            <TabsContent value="status" className="mt-2">
              <div className="space-y-1">
                {statusNotes.map((note) => (
                  <NoteListItem key={note.id} note={note} onSelectNote={onSelectNote} />
                ))}
              </div>
            </TabsContent>
          )}

          {hasPeople && (
            <TabsContent value="people" className="mt-2">
              <div className="flex flex-wrap gap-2 py-2">
                {[...allPeople.values()].map((name) => (
                  <Badge key={name} variant="secondary" className="text-xs">
                    <Users className="h-3 w-3 mr-1" />
                    {name}
                  </Badge>
                ))}
                {[...allCompanies.values()].map((name) => (
                  <Badge key={name} variant="outline" className="text-xs">
                    <Building2 className="h-3 w-3 mr-1" />
                    {name}
                  </Badge>
                ))}
              </div>
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}
