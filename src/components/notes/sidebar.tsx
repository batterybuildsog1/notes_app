"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Plus, Search, X, Menu, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { NoteWithEntities } from "@/lib/db";

interface SidebarProps {
  notes: NoteWithEntities[];
  categories: string[];
  activeNoteId: string | null;
  onSelectNote: (noteId: string) => void;
  onNewNote: () => void;
  categoryFilter: string | null;
  onCategoryFilter: (category: string | null) => void;
  searchQuery: string;
  onSearch: (query: string) => void;
  isOpen: boolean;
  onClose: () => void;
}

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

function categoryCounts(notes: NoteWithEntities[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const note of notes) {
    const cat = note.category || "uncategorized";
    counts[cat] = (counts[cat] || 0) + 1;
  }
  return counts;
}

export function Sidebar({
  notes,
  categories,
  activeNoteId,
  onSelectNote,
  onNewNote,
  categoryFilter,
  onCategoryFilter,
  searchQuery,
  onSearch,
  isOpen,
  onClose,
}: SidebarProps) {
  const [localSearch, setLocalSearch] = useState(searchQuery);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLocalSearch(searchQuery);
  }, [searchQuery]);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setLocalSearch(val);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => onSearch(val), 200);
    },
    [onSearch]
  );

  const handleClearSearch = useCallback(() => {
    setLocalSearch("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    onSearch("");
    inputRef.current?.focus();
  }, [onSearch]);

  const counts = categoryCounts(notes);

  // Filtered notes based on category and search are already handled by AppShell
  // We just display what we're given

  return (
    <>
      {/* Mobile overlay backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`
          fixed md:relative z-50 md:z-auto
          top-0 left-0 h-full
          w-[280px] shrink-0
          bg-background border-r
          flex flex-col
          transition-transform duration-200 ease-in-out
          ${isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
          md:translate-x-0
        `}
      >
        {/* New Note button */}
        <div className="p-3 border-b">
          <Button
            onClick={() => {
              onNewNote();
              onClose();
            }}
            className="w-full justify-start gap-2"
            size="sm"
          >
            <Plus className="h-4 w-4" />
            New Note
          </Button>
        </div>

        {/* Search */}
        <div className="px-3 py-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              ref={inputRef}
              type="text"
              placeholder="Search..."
              value={localSearch}
              onChange={handleSearchChange}
              className="pl-8 pr-8 h-8 text-sm"
            />
            {localSearch && (
              <button
                onClick={handleClearSearch}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Notes list */}
        <div className="flex-1 overflow-y-auto">
          {/* Category filters */}
          <div className="px-3 py-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
              Categories
            </p>
            <button
              onClick={() => onCategoryFilter(null)}
              className={`w-full text-left text-sm px-2 py-1 rounded-md transition-colors ${
                !categoryFilter
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
              }`}
            >
              All Notes
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() =>
                  onCategoryFilter(categoryFilter === cat ? null : cat)
                }
                className={`w-full text-left text-sm px-2 py-1 rounded-md transition-colors flex items-center justify-between ${
                  categoryFilter === cat
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                }`}
              >
                <span className="truncate">{cat}</span>
                {counts[cat] && (
                  <span className="text-xs tabular-nums">{counts[cat]}</span>
                )}
              </button>
            ))}
          </div>

          {/* Recent notes */}
          <div className="px-3 py-2 border-t">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
              Notes
            </p>
            {notes.length === 0 && (
              <p className="text-sm text-muted-foreground px-2 py-4 text-center">
                No notes found
              </p>
            )}
            {notes.map((note) => (
              <button
                key={note.id}
                onClick={() => {
                  onSelectNote(note.id);
                  onClose();
                }}
                className={`w-full text-left px-2 py-2 rounded-md transition-colors group ${
                  activeNoteId === note.id
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50"
                }`}
              >
                <div className="flex items-start gap-2">
                  <FileText className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {note.title || "Untitled"}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-xs text-muted-foreground">
                        {relativeTime(note.display_updated_at || note.updated_at)}
                      </span>
                      {note.category && (
                        <span className="text-xs text-muted-foreground truncate">
                          · {note.category}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </aside>
    </>
  );
}

export function SidebarToggle({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden" onClick={onClick}>
      <Menu className="h-4 w-4" />
    </Button>
  );
}
