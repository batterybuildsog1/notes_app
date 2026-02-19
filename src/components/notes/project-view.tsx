"use client";

import { useState, useEffect } from "react";
import { FileText, Users, Building2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { NoteWithEntities, ProjectWithCounts } from "@/lib/db";

function relativeTime(date: Date | string): string {
  const now = new Date();
  const d = typeof date === "string" ? new Date(date) : date;
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
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
    fetch(`/api/notes?project=${project.id}&limit=100`)
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

  // Collect all unique people and companies across notes
  const allPeople = new Map<string, string>();
  const allCompanies = new Map<string, string>();
  for (const note of notes) {
    note.people?.forEach((p) => allPeople.set(p.id, p.name));
    note.companies?.forEach((c) => allCompanies.set(c.id, c.name));
  }

  return (
    <div className="h-full overflow-y-auto">
      {/* Project header */}
      <div className="border-b px-6 py-5">
        <h1 className="text-xl font-semibold">{project.name}</h1>
        <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <FileText className="h-3.5 w-3.5" />
            {notes.length} notes
          </span>
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
        {(allPeople.size > 0 || allCompanies.size > 0) && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {[...allPeople.values()].slice(0, 8).map((name) => (
              <Badge key={name} variant="secondary" className="text-xs">
                {name}
              </Badge>
            ))}
            {[...allCompanies.values()].slice(0, 5).map((name) => (
              <Badge key={name} variant="outline" className="text-xs">
                {name}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Notes list */}
      <div className="px-4 py-3">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            Loading...
          </div>
        ) : notes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
            <FileText className="h-10 w-10 opacity-20" />
            <p>No notes linked to this project</p>
          </div>
        ) : (
          <div className="space-y-1">
            {notes.map((note) => (
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
                {note.tags && note.tags.length > 0 && (
                  <div className="flex gap-1 mt-1.5">
                    {note.tags.slice(0, 4).map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
