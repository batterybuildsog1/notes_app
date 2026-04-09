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
let cachedNotesLen: number = -1;
let cachedNotesIds: string = "";

function getFuseInstance(notes: Note[]): Fuse<Note> {
  // Rebuild index when notes array changes (length or first/last IDs differ)
  const idsKey = notes.length > 0
    ? `${notes[0].id}:${notes[notes.length - 1].id}`
    : "";
  if (cachedFuse && cachedNotesLen === notes.length && cachedNotesIds === idsKey) {
    return cachedFuse;
  }
  cachedFuse = new Fuse(notes, fuseOptions);
  cachedNotesLen = notes.length;
  cachedNotesIds = idsKey;
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
