import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

async function checkEnrichment() {
  // Check enrichment queue
  const queue = await sql`
    SELECT id, note_id, status, created_at
    FROM enrichment_queue
    ORDER BY created_at DESC
    LIMIT 10
  `;
  console.log("=== Enrichment Queue ===");
  console.log(JSON.stringify(queue, null, 2));

  // Check recent notes with enrichment data
  const notes = await sql`
    SELECT id, title,
           ai_summary IS NOT NULL as has_summary,
           embedding IS NOT NULL as has_embedding,
           created_at
    FROM notes
    ORDER BY created_at DESC
    LIMIT 5
  `;
  console.log("\n=== Recent Notes ===");
  console.log(JSON.stringify(notes, null, 2));

  // Check entity links
  const entities = await sql`
    SELECT
      (SELECT COUNT(*) FROM note_people) as people_links,
      (SELECT COUNT(*) FROM note_companies) as company_links,
      (SELECT COUNT(*) FROM note_projects) as project_links
  `;
  console.log("\n=== Entity Links ===");
  console.log(JSON.stringify(entities, null, 2));

  // Check a sample note with full enrichment
  const enrichedNote = await sql`
    SELECT id, title, ai_summary, tags
    FROM notes
    WHERE ai_summary IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 1
  `;
  if (enrichedNote.length > 0) {
    console.log("\n=== Sample Enriched Note ===");
    console.log(JSON.stringify(enrichedNote[0], null, 2));
  }

  // Check notes table columns
  const columns = await sql`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'notes'
    ORDER BY ordinal_position
  `;
  console.log("\n=== Notes Table Columns ===");
  console.log(columns.map(c => c.column_name).join(', '));
}

checkEnrichment().catch(console.error);
