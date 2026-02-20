"use client";

import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import type { ProjectWithCounts } from "@/lib/db";

interface ProjectBarProps {
  projects: ProjectWithCounts[];
  activeProjectId: string | null;
  onSelectProject: (projectId: string | null) => void;
}

export function ProjectBar({ projects, activeProjectId, onSelectProject }: ProjectBarProps) {
  return (
    <ScrollArea className="w-full hidden md:block">
      <div className="flex items-center gap-1 px-3 py-1.5">
        {projects.map((project) => (
          <button
            key={project.id}
            onClick={() =>
              onSelectProject(activeProjectId === project.id ? null : project.id)
            }
            className={`
              shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-md text-sm font-medium
              transition-colors whitespace-nowrap
              ${
                activeProjectId === project.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              }
            `}
          >
            {project.name}
            {project.external_id && (
              <span className={`text-[10px] font-mono ${
                activeProjectId === project.id
                  ? "text-primary-foreground/70"
                  : "text-muted-foreground/60"
              }`}>
                {project.external_id}
              </span>
            )}
            {project.noteCount > 0 && (
              <Badge
                variant={activeProjectId === project.id ? "secondary" : "outline"}
                className="text-[10px] px-1.5 py-0 h-4 min-w-[1.25rem]"
              >
                {project.noteCount}
              </Badge>
            )}
          </button>
        ))}
        <button
          onClick={() => onSelectProject(null)}
          className={`
            shrink-0 px-3 py-1 rounded-md text-sm font-medium
            transition-colors whitespace-nowrap
            ${
              !activeProjectId
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-accent"
            }
          `}
        >
          All Notes
        </button>
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}
