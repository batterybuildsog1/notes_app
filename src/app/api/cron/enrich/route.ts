/**
 * Vercel Cron - Entity Enrichment Backfill
 * Runs daily to enrich unenriched notes with entity extraction and CRM linking
 *
 * Protected by CRON_SECRET header
 */

import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { enrichWithEntities, linkEntitiesToNote } from "@/lib/entity-extraction";
import { generateEmbedding } from "@/lib/enrichment";

export const runtime = "edge";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes max

const sql = neon(process.env.DATABASE_URL!);

interface Note {
  id: number;
  title: string;
  content: string;
  tags: string[] | null;
  project: string | null;
  user_id: string;
}

const BATCH_SIZE = 75; // Notes per run
const DEFAULT_USER_ID = "3d866169-c8db-4d46-beef-dd6fc4daa930"; // Your user ID

export async function GET(request: NextRequest) {
  // Verify cron secret (Vercel sets this automatically for cron jobs)
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();
  const results = {
    processed: 0,
    enriched: 0,
    titled: 0,
    linked: { people: 0, companies: 0, projects: 0 },
    errors: [] as string[],
    notes: [] as { id: number; title: string; tags: string[] }[],
  };

  try {
    // Get unenriched notes (no enriched_at timestamp or few tags)
    const notesRows = await sql`
      SELECT id, title, content, tags, project, user_id
      FROM notes
      WHERE user_id = ${DEFAULT_USER_ID}
        AND enriched_at IS NULL
      ORDER BY created_at DESC
      LIMIT ${BATCH_SIZE}
    `;
    const notes = notesRows as Note[];

    console.log(`[ENRICH CRON] Found ${notes.length} unenriched notes`);

    for (const note of notes) {
      try {
        // Run entity extraction
        const enrichment = await enrichWithEntities(
          note.title,
          note.content,
          note.tags || []
        );

        const updates: {
          tags?: string[];
          project?: string;
          title?: string;
        } = {};

        // Update tags if we found new ones
        if (enrichment.tags.length > (note.tags?.length || 0)) {
          updates.tags = enrichment.tags;
        }

        // Update project if we found one and note doesn't have one
        if (enrichment.project && !note.project) {
          updates.project = enrichment.project;
        }

        // Update title if suggested and current title is vague
        if (enrichment.newTitle) {
          const isUntitled = !note.title ||
            note.title.toLowerCase() === "untitled" ||
            note.title.trim().length < 3;
          if (isUntitled) {
            updates.title = enrichment.newTitle;
            results.titled++;
          }
        }

        // Link entities to note (CRM-style) - note.id needs to be string for UUID
        if (enrichment.entities) {
          try {
            const noteIdStr = String(note.id);
            const linked = await linkEntitiesToNote(noteIdStr, note.user_id, enrichment.entities);
            results.linked.people += linked.people.length;
            results.linked.companies += linked.companies.length;
            results.linked.projects += linked.projects.length;
          } catch (linkErr) {
            console.warn(`[ENRICH CRON] Entity linking failed for note ${note.id}:`, linkErr);
          }
        }

        // Apply updates
        if (updates.tags || updates.project || updates.title) {
          await sql`
            UPDATE notes
            SET
              tags = COALESCE(${updates.tags || null}::text[], tags),
              project = COALESCE(${updates.project || null}, project),
              title = COALESCE(${updates.title || null}, title),
              enriched_at = NOW(),
              updated_at = NOW()
            WHERE id = ${note.id}
          `;
          results.enriched++;
          results.notes.push({
            id: note.id,
            title: updates.title || note.title,
            tags: updates.tags || note.tags || [],
          });
        } else {
          // Mark as enriched even if no changes (to skip next time)
          await sql`
            UPDATE notes
            SET enriched_at = NOW()
            WHERE id = ${note.id}
          `;
        }

        results.processed++;

        // Generate embedding if missing (check embedding column)
        const embeddingCheck = await sql`
          SELECT embedding IS NOT NULL as has_embedding
          FROM notes WHERE id = ${note.id}
        `;
        if (!(embeddingCheck[0] as { has_embedding: boolean })?.has_embedding) {
          try {
            const fullText = `${updates.title || note.title}\n\n${note.content}`;
            const embedding = await generateEmbedding(fullText);
            if (embedding) {
              const embeddingStr = `[${embedding.join(",")}]`;
              await sql`
                UPDATE notes
                SET embedding = ${embeddingStr}::vector, indexed_at = NOW()
                WHERE id = ${note.id}
              `;
            }
          } catch {
            // Non-fatal
          }
        }
      } catch (error) {
        results.errors.push(`Note ${note.id}: ${error instanceof Error ? error.message : "Unknown"}`);
      }
    }

    const duration = Date.now() - startTime;

    // Get remaining count
    const remainingResult = await sql`
      SELECT COUNT(*) as count FROM notes
      WHERE user_id = ${DEFAULT_USER_ID} AND enriched_at IS NULL
    `;
    const remaining = parseInt((remainingResult[0] as { count: string }).count);

    console.log(`[ENRICH CRON] Completed: ${results.enriched}/${results.processed} enriched, ${remaining} remaining`);

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      duration: `${duration}ms`,
      ...results,
      remaining,
    });
  } catch (error) {
    console.error("[ENRICH CRON] Error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
