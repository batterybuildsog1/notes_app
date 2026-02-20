/**
 * Backfill `source` field on existing notes using pattern matching.
 *
 * Rules:
 * - Notes already having a source → skip
 * - Title starts with "PM:" or "Morning Brief" or "Evening Brief" → "pm-agent"
 * - Category is project-update, decision, meeting-notes, blocker, context → "pm-agent"
 *
 * Usage: npx tsx scripts/backfill-source.ts [--dry-run] [--apply]
 *
 * Requires: DATABASE_URL and SERVICE_USER_ID env vars
 */

import { neon } from "@neondatabase/serverless";

const dryRun = !process.argv.includes("--apply");

interface NoteRow {
  id: string;
  title: string;
  category: string | null;
  source: string | null;
}

function detectSource(note: NoteRow): string | null {
  const title = (note.title || "").toLowerCase();

  // PM agent patterns
  if (
    title.startsWith("pm:") ||
    title.startsWith("morning brief") ||
    title.startsWith("evening brief") ||
    title.startsWith("weekly retro") ||
    title.startsWith("eod capture")
  ) {
    return "pm-agent";
  }

  // PM-authored categories
  const pmCategories = ["project-update", "decision", "meeting-notes", "blocker", "context"];
  if (note.category && pmCategories.includes(note.category)) {
    return "pm-agent";
  }

  return null;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }
  const userId = process.env.SERVICE_USER_ID;
  if (!userId) {
    console.error("SERVICE_USER_ID not set");
    process.exit(1);
  }

  const sql = neon(databaseUrl);

  // Get notes without source
  const notes = (await sql`
    SELECT id, title, category, source
    FROM notes
    WHERE user_id = ${userId} AND (source IS NULL OR source = '')
    ORDER BY created_at DESC
  `) as NoteRow[];

  console.log(`Found ${notes.length} notes without source`);

  const matches: { id: string; title: string; source: string }[] = [];

  for (const note of notes) {
    const source = detectSource(note);
    if (source) {
      matches.push({ id: note.id, title: note.title, source });
    }
  }

  console.log(`\nMatched ${matches.length} notes:`);
  for (const m of matches) {
    console.log(`  [${m.source}] "${m.title.slice(0, 60)}${m.title.length > 60 ? "..." : ""}"`);
  }

  if (dryRun) {
    console.log(`\nDRY RUN — pass --apply to write changes`);
    return;
  }

  // Apply
  let updated = 0;
  for (const m of matches) {
    await sql`UPDATE notes SET source = ${m.source} WHERE id = ${m.id}`;
    updated++;
  }

  console.log(`\nUpdated ${updated} notes`);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
