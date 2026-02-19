"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "@/lib/auth-client";
import { Sidebar, SidebarToggle } from "./sidebar";
import { NoteEditor } from "./note-editor";
import { ProjectBar } from "./project-bar";
import { AgentBar } from "./agent-bar";
import { ProjectView } from "./project-view";
import { AgentView } from "./agent-view";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { User, LogOut, Moon, Sun, FileText } from "lucide-react";
import { searchNotes } from "@/lib/search";
import { getAgentById } from "@/lib/agents";
import type { Note, NoteWithEntities, ProjectWithCounts } from "@/lib/db";

type ActiveView = "notes" | "project" | "agent";

interface AppShellProps {
  initialNotes: NoteWithEntities[];
  categories: string[];
  initialProjects: ProjectWithCounts[];
}

export function AppShell({ initialNotes, categories: initialCategories, initialProjects }: AppShellProps) {
  const router = useRouter();
  const { data: session } = useSession();

  // Core state
  const [notes, setNotes] = useState<NoteWithEntities[]>(initialNotes);
  const [categories, setCategories] = useState<string[]>(initialCategories);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // View state
  const [activeView, setActiveView] = useState<ActiveView>("notes");
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectWithCounts[]>(initialProjects);

  // Theme state
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  // Parse URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const noteId = params.get("note");
    const view = params.get("view");
    const id = params.get("id");

    if (view === "project" && id) {
      setActiveView("project");
      setActiveProjectId(id);
    } else if (view === "agent" && id) {
      setActiveView("agent");
      setActiveAgentId(id);
    } else if (noteId) {
      setActiveNoteId(noteId);
    }
  }, []);

  // Update URL when view/note changes
  useEffect(() => {
    if (activeView === "project" && activeProjectId) {
      window.history.replaceState(null, "", `/?view=project&id=${activeProjectId}`);
    } else if (activeView === "agent" && activeAgentId) {
      window.history.replaceState(null, "", `/?view=agent&id=${activeAgentId}`);
    } else if (activeNoteId) {
      window.history.replaceState(null, "", `/?note=${activeNoteId}`);
    } else {
      window.history.replaceState(null, "", "/");
    }
  }, [activeView, activeProjectId, activeAgentId, activeNoteId]);

  // Filter notes for sidebar display
  const filteredNotes = useMemo(() => {
    let result = notes;
    if (categoryFilter) {
      result = result.filter((n) => n.category === categoryFilter);
    }
    if (searchQuery) {
      result = searchNotes(result, searchQuery);
    }
    return result;
  }, [notes, categoryFilter, searchQuery]);

  // The currently active note object
  const activeNote = useMemo(() => {
    if (!activeNoteId) return undefined;
    return notes.find((n) => n.id === activeNoteId);
  }, [notes, activeNoteId]);

  // Active project object
  const activeProject = useMemo(() => {
    if (!activeProjectId) return undefined;
    return projects.find((p) => p.id === activeProjectId);
  }, [projects, activeProjectId]);

  // Active agent config
  const activeAgent = useMemo(() => {
    if (!activeAgentId) return undefined;
    return getAgentById(activeAgentId);
  }, [activeAgentId]);

  // Handlers
  const handleSelectNote = useCallback((noteId: string) => {
    setActiveNoteId(noteId);
    setActiveView("notes");
  }, []);

  const handleSelectProject = useCallback((projectId: string | null) => {
    if (projectId) {
      setActiveProjectId(projectId);
      setActiveAgentId(null);
      setActiveNoteId(null);
      setActiveView("project");
    } else {
      setActiveProjectId(null);
      setActiveView("notes");
    }
  }, []);

  const handleSelectAgent = useCallback((agentId: string | null) => {
    if (agentId) {
      setActiveAgentId(agentId);
      setActiveProjectId(null);
      setActiveNoteId(null);
      setActiveView("agent");
    } else {
      setActiveAgentId(null);
      setActiveView("notes");
    }
  }, []);

  const handleNoteFromView = useCallback((noteId: string) => {
    setActiveNoteId(noteId);
    setActiveView("notes");
  }, []);

  const handleNewNote = useCallback(async () => {
    try {
      const response = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "", content: "" }),
      });
      if (response.ok) {
        const newNote: NoteWithEntities = await response.json();
        setNotes((prev) => [newNote, ...prev]);
        setActiveNoteId(newNote.id);
        setActiveView("notes");
      }
    } catch (error) {
      console.error("Failed to create note:", error);
    }
  }, []);

  const handleNoteCreated = useCallback((note: Note) => {
    setNotes((prev) => {
      if (prev.some((n) => n.id === note.id)) return prev;
      return [note as NoteWithEntities, ...prev];
    });
    setActiveNoteId(note.id);
  }, []);

  const handleNoteSaved = useCallback(
    (update: { id: string; title: string; content: string; tags: string[] | null; updated_at: Date }) => {
      setNotes((prev) =>
        prev.map((n) =>
          n.id === update.id
            ? { ...n, title: update.title, content: update.content, tags: update.tags, updated_at: update.updated_at }
            : n
        )
      );
    },
    []
  );

  const handleNoteDeleted = useCallback(
    (noteId: string) => {
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
      if (activeNoteId === noteId) {
        setActiveNoteId(null);
      }
    },
    [activeNoteId]
  );

  const handleCategoryFilter = useCallback((cat: string | null) => {
    setCategoryFilter(cat);
  }, []);

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  const toggleTheme = () => {
    const newMode = !isDark;
    setIsDark(newMode);
    document.documentElement.classList.toggle("dark", newMode);
    localStorage.setItem("theme", newMode ? "dark" : "light");
  };

  const handleSignOut = async () => {
    await signOut();
    router.push("/login");
    router.refresh();
  };

  // Refresh notes list from server
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const params = new URLSearchParams({ limit: "50" });
        const res = await fetch(`/api/notes?${params}`);
        if (res.ok) {
          const freshNotes: NoteWithEntities[] = await res.json();
          setNotes(freshNotes);
          const cats = new Set<string>();
          freshNotes.forEach((n) => {
            if (n.category) cats.add(n.category);
          });
          const sorted = [...cats].sort();
          setCategories(sorted);
        }
      } catch {
        // Silent fail on background refresh
      }
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // Whether we're showing a project/agent view (hides sidebar+editor)
  const showingView = activeView === "project" || activeView === "agent";

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Row 1: Project bar + utility icons */}
      <header className="border-b shrink-0 bg-background/95 backdrop-blur z-30">
        <div className="flex items-center justify-between h-10">
          <div className="flex items-center gap-1 min-w-0 flex-1">
            <SidebarToggle onClick={() => setSidebarOpen(true)} />
            <ProjectBar
              projects={projects}
              activeProjectId={activeView === "project" ? activeProjectId : null}
              onSelectProject={handleSelectProject}
            />
          </div>
          <div className="flex items-center gap-1 shrink-0 pr-2">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={toggleTheme}>
              {isDark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7">
                  <User className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {session?.user && (
                  <DropdownMenuItem disabled className="text-muted-foreground text-xs">
                    {session.user.email}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={handleSignOut}>
                  <LogOut className="h-4 w-4 mr-2" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Row 2: Agent bar */}
        <div className="border-t">
          <AgentBar
            activeAgentId={activeView === "agent" ? activeAgentId : null}
            onSelectAgent={handleSelectAgent}
          />
        </div>
      </header>

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {showingView ? (
          // Project or Agent view — full width
          <main className="flex-1 overflow-hidden">
            {activeView === "project" && activeProject && (
              <ProjectView
                project={activeProject}
                onSelectNote={handleNoteFromView}
              />
            )}
            {activeView === "agent" && activeAgent && (
              <AgentView
                agent={activeAgent}
                onSelectNote={handleNoteFromView}
              />
            )}
          </main>
        ) : (
          // Default sidebar + editor layout
          <>
            <Sidebar
              notes={filteredNotes}
              categories={categories}
              activeNoteId={activeNoteId}
              onSelectNote={handleSelectNote}
              onNewNote={handleNewNote}
              categoryFilter={categoryFilter}
              onCategoryFilter={handleCategoryFilter}
              searchQuery={searchQuery}
              onSearch={handleSearch}
              isOpen={sidebarOpen}
              onClose={() => setSidebarOpen(false)}
            />

            <main className="flex-1 overflow-hidden">
              {activeNote || activeNoteId ? (
                <NoteEditor
                  key={activeNoteId}
                  note={activeNote}
                  onSave={handleNoteSaved}
                  onDelete={handleNoteDeleted}
                  onCreate={handleNoteCreated}
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
                  <FileText className="h-12 w-12 opacity-20" />
                  <p className="text-lg">Select a note or create a new one</p>
                  <p className="text-sm">
                    Click <strong>+ New Note</strong> in the sidebar to get started
                  </p>
                </div>
              )}
            </main>
          </>
        )}
      </div>
    </div>
  );
}
