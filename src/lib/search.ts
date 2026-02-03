import Fuse from "fuse.js";
import type { Note } from "./db";

const fuseOptions = {
  keys: [
    { name: "title", weight: 0.4 },
    { name: "content", weight: 0.3 },
    { name: "category", weight: 0.15 },
    { name: "tags", weight: 0.15 },
  ],
  threshold: 0.3,
  includeScore: true,
  ignoreLocation: true,
};

// Cache Fuse instance to avoid recreation on every search
let cachedFuse: Fuse<Note> | null = null;
let cachedNotesRef: Note[] | null = null;

function getFuseInstance(notes: Note[]): Fuse<Note> {
  // Only recreate if notes array reference changed
  if (cachedFuse && cachedNotesRef === notes) {
    return cachedFuse;
  }
  cachedFuse = new Fuse(notes, fuseOptions);
  cachedNotesRef = notes;
  return cachedFuse;
}

export function searchNotes(notes: Note[], query: string): Note[] {
  if (!query || query.trim() === "") {
    return notes;
  }

  const fuse = getFuseInstance(notes);
  const results = fuse.search(query);
  return results.map((result) => result.item);
}
