"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "@/lib/auth-client";
import { Sidebar, SidebarToggle } from "./sidebar";
import { NoteEditor } from "./note-editor";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { User, LogOut, Moon, Sun, FileText } from "lucide-react";
import { searchNotes } from "@/lib/search";
import type { Note, NoteWithEntities } from "@/lib/db";

interface AppShellProps {
  initialNotes: NoteWithEntities[];
  categories: string[];
}

export function AppShell({ initialNotes, categories: initialCategories }: AppShellProps) {
  const router = useRouter();
  const { data: session } = useSession();

  // Core state
  const [notes, setNotes] = useState<NoteWithEntities[]>(initialNotes);
  const [categories, setCategories] = useState<string[]>(initialCategories);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Theme state
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  // Parse URL on mount to open a note if specified
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const noteId = params.get("note");
    if (noteId) {
      setActiveNoteId(noteId);
    }
  }, []);

  // Update URL when active note changes
  useEffect(() => {
    if (activeNoteId) {
      window.history.replaceState(null, "", `/?note=${activeNoteId}`);
    } else {
      window.history.replaceState(null, "", "/");
    }
  }, [activeNoteId]);

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

  // Handlers
  const handleSelectNote = useCallback((noteId: string) => {
    setActiveNoteId(noteId);
  }, []);

  const handleNewNote = useCallback(async () => {
    // Create a blank note immediately via POST
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
      }
    } catch (error) {
      console.error("Failed to create note:", error);
    }
  }, []);

  const handleNoteCreated = useCallback((note: Note) => {
    // Note was created from the editor (typed into a blank editor)
    // Add to notes list if not already there
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
      // Update categories if new one was detected
      // (We'll do a lightweight refresh of categories periodically)
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

  // Refresh notes list from server (e.g., after category changes from enrichment)
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const params = new URLSearchParams({ limit: "50" });
        const res = await fetch(`/api/notes?${params}`);
        if (res.ok) {
          const freshNotes: NoteWithEntities[] = await res.json();
          setNotes(freshNotes);
          // Extract categories from fresh data
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
    }, 60000); // Every 60s
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Top bar */}
      <header className="h-12 border-b flex items-center justify-between px-3 shrink-0 bg-background/95 backdrop-blur z-30">
        <div className="flex items-center gap-2">
          <SidebarToggle onClick={() => setSidebarOpen(true)} />
          <span className="text-sm font-medium hidden md:inline">Notes</span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleTheme}>
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <User className="h-4 w-4" />
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
      </header>

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
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

        {/* Main editor area */}
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
      </div>
    </div>
  );
}
