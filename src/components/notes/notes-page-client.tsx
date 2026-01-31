"use client";

import { useState, useMemo, useCallback } from "react";
import { SearchBar } from "./search-bar";
import { CategoryFilter } from "./category-filter";
import { NoteList } from "./note-list";
import { QuickAddDialog } from "./quick-add-dialog";
import { searchNotes } from "@/lib/search";
import type { Note } from "@/lib/db";

interface NotesPageClientProps {
  initialNotes: Note[];
  categories: string[];
}

export function NotesPageClient({ initialNotes, categories }: NotesPageClientProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  const handleCategorySelect = useCallback((category: string) => {
    setSelectedCategory(category);
  }, []);

  const filteredNotes = useMemo(() => {
    let notes = initialNotes;

    // Filter by category
    if (selectedCategory !== "all") {
      notes = notes.filter((note) => note.category === selectedCategory);
    }

    // Apply fuzzy search
    if (searchQuery) {
      notes = searchNotes(notes, searchQuery);
    }

    return notes;
  }, [initialNotes, searchQuery, selectedCategory]);

  return (
    <>
      <div className="space-y-4 mb-6">
        <SearchBar onSearch={handleSearch} />
        <CategoryFilter
          categories={categories}
          selected={selectedCategory}
          onSelect={handleCategorySelect}
        />
      </div>

      <NoteList notes={filteredNotes} />
      <QuickAddDialog />
    </>
  );
}
