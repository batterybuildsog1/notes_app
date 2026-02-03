"use client";

import { useState, useMemo, useCallback } from "react";
import { SearchBar } from "./search-bar";
import { NoteList } from "./note-list";
import { QuickAddDialog } from "./quick-add-dialog";
import { searchNotes } from "@/lib/search";
import type { Note } from "@/lib/db";

interface NotesPageClientProps {
  initialNotes: Note[];
  categories: string[];
}

export function NotesPageClient({ initialNotes, categories: _categories }: NotesPageClientProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  const filteredNotes = useMemo(() => {
    if (!searchQuery) {
      return initialNotes;
    }
    return searchNotes(initialNotes, searchQuery);
  }, [initialNotes, searchQuery]);

  return (
    <>
      <div className="mb-4 md:mb-6">
        <SearchBar onSearch={handleSearch} />
      </div>

      <NoteList notes={filteredNotes} />
      <QuickAddDialog />
    </>
  );
}
