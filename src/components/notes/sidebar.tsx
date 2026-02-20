"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Plus, Search, X, FileText, ChevronDown, ChevronRight, Loader2, Trash2, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { NoteWithEntities } from "@/lib/db";
import { relativeTime } from "@/lib/utils";
import { getAgentBySource } from "@/lib/agents";

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
  onDelete?: (noteId: string) => void;
  onRefresh?: () => Promise<void>;
}

function categoryCounts(notes: NoteWithEntities[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const note of notes) {
    const cat = note.category || "uncategorized";
    counts[cat] = (counts[cat] || 0) + 1;
  }
  return counts;
}

// --- Swipe-to-delete note item ---

interface SwipeNoteItemProps {
  note: NoteWithEntities;
  isActive: boolean;
  onSelect: () => void;
  onDelete?: () => void;
}

function SwipeNoteItem({ note, isActive, onSelect, onDelete }: SwipeNoteItemProps) {
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const swipeActiveRef = useRef<boolean | null>(null);
  const [offset, setOffset] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const [snapped, setSnapped] = useState(false);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    startXRef.current = touch.clientX;
    startYRef.current = touch.clientY;
    swipeActiveRef.current = null;
    setSwiping(true);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    const dx = touch.clientX - startXRef.current;
    const dy = touch.clientY - startYRef.current;

    // Determine swipe direction on first significant movement
    if (swipeActiveRef.current === null) {
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        swipeActiveRef.current = Math.abs(dx) > Math.abs(dy);
      }
      return;
    }

    if (!swipeActiveRef.current) return;

    // Only allow swipe left (negative offset), max -80px
    const newOffset = snapped ? Math.max(-80, Math.min(0, -80 + dx)) : Math.max(-80, Math.min(0, dx));
    setOffset(newOffset);
  }, [snapped]);

  const handleTouchEnd = useCallback(() => {
    setSwiping(false);
    if (offset < -60) {
      setOffset(-80);
      setSnapped(true);
    } else {
      setOffset(0);
      setSnapped(false);
    }
    swipeActiveRef.current = null;
  }, [offset]);

  const handleDeleteClick = useCallback(() => {
    setOffset(0);
    setSnapped(false);
    onDelete?.();
  }, [onDelete]);

  // Reset swipe if user taps elsewhere
  const handleClick = useCallback(() => {
    if (snapped) {
      setOffset(0);
      setSnapped(false);
      return;
    }
    if (Math.abs(offset) < 5) {
      onSelect();
    }
  }, [snapped, offset, onSelect]);

  return (
    <div className="swipe-container">
      {/* Delete zone behind the note */}
      <div className="absolute inset-y-0 right-0 w-20 flex items-center justify-center bg-destructive">
        <button
          onClick={handleDeleteClick}
          className="flex items-center justify-center w-full h-full text-destructive-foreground"
          aria-label="Delete note"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* Swipeable note content */}
      <div
        className={`swipe-content bg-background ${swiping ? "swiping" : ""}`}
        style={{ transform: `translateX(${offset}px)` }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <button
          onClick={handleClick}
          className={`w-full text-left px-2 py-3 md:py-2 min-h-[44px] md:min-h-0 rounded-md transition-colors group ${
            isActive
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
                {note.source && (() => {
                  const agent = getAgentBySource(note.source);
                  return agent ? (
                    <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                      · <Bot className="h-2.5 w-2.5" /> {agent.name}
                    </span>
                  ) : null;
                })()}
                {note.category && (
                  <span className="text-xs text-muted-foreground truncate">
                    · {note.category}
                  </span>
                )}
              </div>
            </div>
          </div>
        </button>
      </div>
    </div>
  );
}

// --- Main Sidebar ---

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
  onDelete,
  onRefresh,
}: SidebarProps) {
  const [localSearch, setLocalSearch] = useState(searchQuery);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Pull-to-refresh state
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const pullStartYRef = useRef(0);
  const pullActiveRef = useRef(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

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

  // Pull-to-refresh handlers
  const handlePullTouchStart = useCallback((e: React.TouchEvent) => {
    const container = scrollContainerRef.current;
    if (!container || container.scrollTop > 0 || refreshing) return;
    pullStartYRef.current = e.touches[0].clientY;
    pullActiveRef.current = true;
  }, [refreshing]);

  const handlePullTouchMove = useCallback((e: React.TouchEvent) => {
    if (!pullActiveRef.current) return;
    const container = scrollContainerRef.current;
    if (!container || container.scrollTop > 0) {
      pullActiveRef.current = false;
      setPullDistance(0);
      return;
    }
    const dy = e.touches[0].clientY - pullStartYRef.current;
    if (dy > 0) {
      // Dampen the pull distance
      setPullDistance(Math.min(dy * 0.5, 80));
    }
  }, []);

  const handlePullTouchEnd = useCallback(async () => {
    if (!pullActiveRef.current) return;
    pullActiveRef.current = false;

    if (pullDistance >= 60 && onRefresh) {
      setRefreshing(true);
      setPullDistance(40); // Hold at indicator position while refreshing
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0);
    }
  }, [pullDistance, onRefresh]);

  const counts = categoryCounts(notes);

  return (
    <aside className="flex flex-col h-full bg-background md:w-[280px] md:shrink-0 md:border-r">
      {/* Mobile header */}
      <div className="flex items-center justify-between px-4 py-3 border-b md:hidden">
        <h1 className="text-lg font-semibold">Notes</h1>
        <Button
          onClick={onNewNote}
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* Desktop New Note button */}
      <div className="hidden md:block p-3 border-b">
        <Button
          onClick={onNewNote}
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

      {/* Scrollable content: categories + notes */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto"
        onTouchStart={handlePullTouchStart}
        onTouchMove={handlePullTouchMove}
        onTouchEnd={handlePullTouchEnd}
      >
        {/* Pull-to-refresh indicator */}
        {(pullDistance > 0 || refreshing) && (
          <div
            className="flex items-center justify-center overflow-hidden"
            style={{ height: `${pullDistance}px` }}
          >
            <Loader2
              className={`h-5 w-5 text-muted-foreground ${refreshing ? "animate-spin" : ""}`}
              style={{
                transform: refreshing ? undefined : `scale(${Math.min(pullDistance / 60, 1)})`,
                opacity: Math.min(pullDistance / 40, 1),
              }}
            />
          </div>
        )}

        {/* Category filters */}
        <div className="px-3 py-2">
          {/* Mobile: collapsible categories header */}
          <button
            onClick={() => setCategoriesOpen((prev) => !prev)}
            className="flex items-center gap-1 w-full text-left mb-1.5 md:hidden"
          >
            {categoriesOpen ? (
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
            )}
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Categories
            </span>
          </button>

          {/* Desktop: static categories label */}
          <p className="hidden md:block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
            Categories
          </p>

          {/* Category buttons - always visible on desktop, toggled on mobile */}
          <div className={`${categoriesOpen ? "block" : "hidden"} md:block`}>
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
        </div>

        {/* Notes list */}
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
            <SwipeNoteItem
              key={note.id}
              note={note}
              isActive={activeNoteId === note.id}
              onSelect={() => onSelectNote(note.id)}
              onDelete={onDelete ? () => onDelete(note.id) : undefined}
            />
          ))}
        </div>
      </div>
    </aside>
  );
}
