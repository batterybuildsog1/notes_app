/**
 * Enrichment Pipeline Diagnostics
 *
 * Run this to verify the full pipeline and process pending items.
 *
 * Usage: node scripts/diagnose-enrichment.mjs [--process-all]
 */

import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);
const GROK_API_URL = "https://api.x.ai/v1/responses";
const GROK_MODEL = "grok-4-1-fast";

async function diagnose() {
  console.log("=== Enrichment Pipeline Diagnostics ===\n");

  // 1. Check database stats
  console.log("1. Database Status:");
  const stats = await sql`
    SELECT
      (SELECT COUNT(*) FROM notes) as total_notes,
      (SELECT COUNT(*) FROM notes WHERE enriched_at IS NOT NULL) as enriched_notes,
      (SELECT COUNT(*) FROM notes WHERE ai_summary IS NOT NULL) as notes_with_summary,
      (SELECT COUNT(*) FROM enrichment_queue WHERE status = 'pending') as queue_pending,
      (SELECT COUNT(*) FROM enrichment_queue WHERE status = 'completed') as queue_completed,
      (SELECT COUNT(*) FROM enrichment_queue WHERE status = 'failed') as queue_failed
  `;
  console.log(JSON.stringify(stats[0], null, 2));

  // 2. Check cron configuration
  console.log("\n2. Cron Configuration (from vercel.json):");
  console.log("   /api/cron/enrich       - 7 AM UTC daily (basic tags/project)");
  console.log("   /api/cron/enrich-batch - 9 AM UTC daily (AI summaries)");

  // 3. Check pending items
  const pending = await sql`
    SELECT eq.id, eq.note_id, eq.status, eq.created_at, n.title
    FROM enrichment_queue eq
    JOIN notes n ON n.id = eq.note_id
    WHERE eq.status = 'pending'
    ORDER BY eq.created_at ASC
    LIMIT 10
  `;

  console.log(`\n3. Pending Queue Items: ${pending.length}`);
  pending.forEach((p, i) => {
    console.log(`   ${i + 1}. "${p.title}" (queued: ${new Date(p.created_at).toISOString()})`);
  });

  // 4. Check if Grok API is working
  console.log("\n4. Grok API Test:");
  try {
    const response = await fetch(GROK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.XAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROK_MODEL,
        input: [{ role: "user", content: "Say 'API working' in exactly those words." }],
        temperature: 0,
      }),
    });

    if (response.ok) {
      console.log("   Grok API: OK");
    } else {
      console.log(`   Grok API: ERROR ${response.status}`);
    }
  } catch (err) {
    console.log(`   Grok API: ERROR - ${err.message}`);
  }

  // 5. Process all pending if flag is set
  if (process.argv.includes("--process-all")) {
    console.log("\n5. Processing all pending items...\n");
    for (const item of pending) {
      await processNote(item);
    }
  } else {
    console.log("\n5. To process all pending items, run:");
    console.log("   node scripts/diagnose-enrichment.mjs --process-all");
  }

  // 6. Summary
  console.log("\n=== Summary ===");
  if (pending.length === 0) {
    console.log("All notes processed. Cron is working correctly.");
  } else {
    console.log(`${pending.length} notes pending enrichment.`);
    console.log("The cron job will process these at 9 AM UTC.");
    console.log("Or run with --process-all to process now.");
  }
}

async function processNote(item) {
  console.log(`Processing: "${item.title}"...`);

  // Get note content
  const notes = await sql`
    SELECT n.*,
      (SELECT array_agg(p.name) FROM projects p WHERE p.user_id = n.user_id LIMIT 10) as known_projects,
      (SELECT array_agg(p.name) FROM people p WHERE p.user_id = n.user_id LIMIT 10) as known_people,
      (SELECT array_agg(c.name) FROM companies c WHERE c.user_id = n.user_id LIMIT 10) as known_companies
    FROM notes n
    WHERE n.id = ${item.note_id}
  `;

  if (notes.length === 0) {
    console.log(`  ERROR: Note not found`);
    return;
  }

  const note = notes[0];

  const prompt = `Analyze this note from a real estate business.

## Known Context
- Projects: ${note.known_projects?.join(', ') || 'none'}
- People: ${note.known_people?.join(', ') || 'none'}
- Companies: ${note.known_companies?.join(', ') || 'none'}

## Note
Title: ${note.title}
Content: ${note.content?.substring(0, 3000)}

Return JSON with:
{
  "summary": {
    "context": "1-2 sentence description",
    "keyPoints": ["2-4 key facts"],
    "peopleAndRoles": {"Name": "role"},
    "decisionsMade": ["decisions"],
    "nextSteps": ["action items"]
  },
  "entities": {
    "people": ["names"],
    "companies": ["companies"],
    "projects": ["projects"]
  },
  "actionItems": [
    {"text": "action", "assignee": "person or null", "priority": "high|medium|low"}
  ],
  "tags": ["relevant-tags"]
}`;

  try {
    const response = await fetch(GROK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.XAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROK_MODEL,
        input: [{ role: "user", content: prompt }],
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      console.log(`  ERROR: Grok API returned ${response.status}`);
      return;
    }

    const result = await response.json();

    // Extract content
    let content = "";
    for (const item of result.output || []) {
      if (item.type === "message" && item.role === "assistant") {
        for (const c of item.content || []) {
          if (c.type === "output_text") {
            content = c.text;
            break;
          }
        }
      }
    }

    // Parse JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const enrichment = JSON.parse(jsonMatch[0]);

      // Update note
      if (enrichment.summary) {
        await sql`
          UPDATE notes
          SET ai_summary = ${JSON.stringify(enrichment.summary)},
              summary_generated_at = NOW(),
              enriched_at = NOW()
          WHERE id = ${item.note_id}
        `;
      }

      // Mark completed
      await sql`
        UPDATE enrichment_queue
        SET status = 'completed'
        WHERE id = ${item.id}
      `;

      console.log(`  OK - Summary generated`);
    } else {
      console.log(`  ERROR: Could not parse JSON response`);
    }
  } catch (err) {
    console.log(`  ERROR: ${err.message}`);
  }
}

diagnose().catch(console.error);
