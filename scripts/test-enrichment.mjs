/**
 * Manual Enrichment Test Script
 *
 * Processes one note from the queue to test the full enrichment pipeline
 */

import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);
const GROK_API_URL = "https://api.x.ai/v1/responses";
const GROK_MODEL = "grok-4-1-fast";

async function testEnrichment() {
  console.log("=== Testing Enrichment Pipeline ===\n");

  // Get one pending note
  const pendingNotes = await sql`
    SELECT eq.id as queue_id, eq.note_id, n.title, n.content, n.user_id
    FROM enrichment_queue eq
    JOIN notes n ON n.id = eq.note_id
    WHERE eq.status = 'pending'
    ORDER BY eq.created_at ASC
    LIMIT 1
  `;

  if (pendingNotes.length === 0) {
    console.log("No pending notes in queue");
    return;
  }

  const note = pendingNotes[0];
  console.log(`Processing: "${note.title}"`);
  console.log(`Content preview: ${note.content?.substring(0, 200)}...\n`);

  // Build context
  const [projects, people, companies] = await Promise.all([
    sql`SELECT name FROM projects WHERE user_id = ${note.user_id} LIMIT 10`,
    sql`SELECT name FROM people WHERE user_id = ${note.user_id} LIMIT 10`,
    sql`SELECT name FROM companies WHERE user_id = ${note.user_id} LIMIT 10`,
  ]);

  console.log("Context:");
  console.log(`- Projects: ${projects.map(p => p.name).join(', ') || 'none'}`);
  console.log(`- People: ${people.map(p => p.name).join(', ') || 'none'}`);
  console.log(`- Companies: ${companies.map(c => c.name).join(', ') || 'none'}\n`);

  // Build prompt
  const prompt = `Analyze this note from a real estate business.

## Known Context
- Projects: ${projects.map(p => p.name).join(', ') || 'none'}
- People: ${people.map(p => p.name).join(', ') || 'none'}
- Companies: ${companies.map(c => c.name).join(', ') || 'none'}

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

  console.log("Calling Grok API...\n");

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
      const error = await response.text();
      console.error("Grok API error:", error);
      return;
    }

    const result = await response.json();

    // Extract content from response
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

    console.log("=== Grok Response ===\n");
    console.log(content);

    // Try to parse as JSON
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const enrichment = JSON.parse(jsonMatch[0]);
        console.log("\n=== Parsed Enrichment ===\n");
        console.log(JSON.stringify(enrichment, null, 2));

        // Update the note with summary
        if (enrichment.summary) {
          await sql`
            UPDATE notes
            SET ai_summary = ${JSON.stringify(enrichment.summary)},
                summary_generated_at = NOW(),
                enriched_at = NOW()
            WHERE id = ${note.note_id}
          `;
          console.log("\n✓ Updated note with AI summary");
        }

        // Mark queue item as completed
        await sql`
          UPDATE enrichment_queue
          SET status = 'completed'
          WHERE id = ${note.queue_id}
        `;
        console.log("✓ Marked queue item as completed");
      }
    } catch (parseErr) {
      console.error("Failed to parse JSON:", parseErr.message);
    }

    // Show usage
    if (result.usage) {
      console.log(`\nTokens: ${result.usage.input_tokens} in, ${result.usage.output_tokens} out`);
      if (result.usage.cost_in_usd_ticks) {
        console.log(`Cost: $${(result.usage.cost_in_usd_ticks / 1e9).toFixed(4)}`);
      }
    }

  } catch (error) {
    console.error("Error:", error);
  }
}

testEnrichment().catch(console.error);
