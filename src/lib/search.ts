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

export function searchNotes(notes: Note[], query: string): Note[] {
  if (!query || query.trim() === "") {
    return notes;
  }

  const fuse = new Fuse(notes, fuseOptions);
  const results = fuse.search(query);
  return results.map((result) => result.item);
}
