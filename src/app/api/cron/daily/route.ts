/**
 * Fixed Cron - Works with 1x/day schedule
 * 
 * Key changes:
 * - Larger batch size (50-100 notes per day)
 * - Saves people to DB and links to notes
 * - Creates action items from nextSteps
 * - Sends Telegram clarifications
 */

import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import {
  batchExtractEnrichments,
  batchGenerateEmbeddings,
  findOrCreatePerson,
  linkPersonToNote,
  createActionItem,
  sendTelegramClarification,
  type EnrichmentResult,
} from "@/lib/batch-enrichment";
import {
  claimEnrichmentBatch,
  completeQueueItems,
  failQueueItem,
  getQueueStats,
  createClarification,
  getPendingClarificationForNote,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // Hobby plan: 60s max for Node.js

const sql = neon(process.env.DATABASE_URL!);

// Node.js runtime: 60s limit on Hobby plan
// Keep batch modest for stability, but process on a queue every 5 minutes.
const BATCH_SIZE = 12;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();
  const results = {
    processed: 0,
    enriched: 0,
    peopleLinked: 0,
    actionItemsCreated: 0,
    clarificationsSent: 0,
    embedded: 0,
    categorized: 0,
    titled: 0,
    typed: 0,
    errors: [] as string[],
  };

  try {
    console.log(`[ENRICH] Starting run, batch size: ${BATCH_SIZE}`);

    // Seed queue with older unenriched notes that are not queued yet.
    await sql`
      INSERT INTO enrichment_queue (note_id, user_id, priority)
      SELECT n.id, n.user_id::uuid, 0
      FROM notes n
      WHERE n.enriched_at IS NULL
        AND n.created_at < NOW() - INTERVAL '1 hour'
        AND NOT EXISTS (
          SELECT 1 FROM enrichment_queue q
          WHERE q.note_id = n.id
            AND q.status IN ('pending', 'processing')
        )
      ORDER BY n.created_at ASC
      LIMIT 200
      ON CONFLICT (note_id) DO NOTHING
    `;

    // Also re-queue enriched notes that are still missing category (backlog fix)
    await sql`
      INSERT INTO enrichment_queue (note_id, user_id, priority)
      SELECT n.id, n.user_id::uuid, -1
      FROM notes n
      WHERE n.enriched_at IS NOT NULL
        AND n.category IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM enrichment_queue q
          WHERE q.note_id = n.id
            AND q.status IN ('pending', 'processing')
        )
      ORDER BY n.created_at ASC
      LIMIT 50
      ON CONFLICT (note_id) DO NOTHING
    `;

    const queueBefore = await getQueueStats();
    const claimed = await claimEnrichmentBatch(BATCH_SIZE);

    if (claimed.length === 0) {
      return NextResponse.json({
        ok: true,
        message: "No notes to process",
        timestamp: new Date().toISOString(),
        queue: queueBefore,
      });
    }

    // Group by user context so enrichment has the right knowledge base.
    const byUser = new Map<string, typeof claimed>();
    for (const item of claimed) {
      if (!byUser.has(item.userId)) byUser.set(item.userId, []);
      byUser.get(item.userId)!.push(item);
    }

    const enrichmentByNoteId = new Map<string, EnrichmentResult>();
    for (const [, group] of byUser) {
      const input = group.map((item) => ({
        id: item.noteId,
        title: item.title,
        content: item.content,
        userId: item.userId,
      }));
      const groupResults = await batchExtractEnrichments(input);
      for (const [noteId, enrichment] of groupResults) {
        enrichmentByNoteId.set(noteId, enrichment);
      }
    }

    const successfulQueueIds: string[] = [];

    for (const item of claimed) {
      const noteId = item.noteId;
      const userId = item.userId;
      const enrichment = enrichmentByNoteId.get(noteId);

      if (!enrichment) {
        const msg = `${noteId}: No enrichment extracted`;
        results.errors.push(msg);
        await failQueueItem(item.queueId, msg);
        continue;
      }

      try {
        await sql`
          UPDATE notes
          SET
            ai_summary = ${JSON.stringify(enrichment.summary)},
            summary_generated_at = NOW(),
            enriched_at = NOW(),
            updated_at = NOW()
          WHERE id = ${noteId}
        `;

        // Apply category if note has none and enrichment extracted one
        if (enrichment.category) {
          const catResult = await sql`
            UPDATE notes SET category = ${enrichment.category}, updated_at = NOW()
            WHERE id = ${noteId} AND category IS NULL
          `;
          if (catResult.length !== undefined) results.categorized++;
        }

        // Apply note_type if enrichment extracted one
        if (enrichment.noteType) {
          try {
            await sql`
              UPDATE notes SET note_type = ${enrichment.noteType}, updated_at = NOW()
              WHERE id = ${noteId} AND (note_type IS NULL OR note_type = '')
            `;
            results.typed++;
          } catch {
            // note_type column may not exist yet — skip silently
          }
        }

        // Apply suggested title if note is untitled
        if (enrichment.suggestedTitle) {
          const isUntitled = !item.title ||
            item.title.toLowerCase().trim() === 'untitled' ||
            item.title.trim().length < 3;
          if (isUntitled) {
            await sql`
              UPDATE notes SET title = ${enrichment.suggestedTitle}, updated_at = NOW()
              WHERE id = ${noteId}
            `;
            results.titled++;
          }
        }

        for (const [personName, role] of Object.entries(enrichment.summary.peopleAndRoles)) {
          try {
            const person = await findOrCreatePerson(userId, personName);
            await linkPersonToNote(noteId, person.id, role as string);
            results.peopleLinked++;
          } catch (err) {
            console.warn(`[ENRICH] Failed to link person ${personName}:`, err);
          }
        }

        for (const step of enrichment.summary.nextSteps) {
          try {
            await createActionItem(noteId, userId, step, "ai_extracted");
            results.actionItemsCreated++;
          } catch (err) {
            console.warn(`[ENRICH] Failed to create action item:`, err);
          }
        }

        // Quality loop: persist clarification questions before messaging.
        if (enrichment.ambiguities.length > 0) {
          const existingPending = await getPendingClarificationForNote(noteId);
          if (!existingPending) {
            await createClarification(noteId, userId, enrichment.ambiguities[0].question);
          }

          if (results.clarificationsSent < 8) {
            try {
              const sent = await sendTelegramClarification(
                item.title || "Untitled Note",
                enrichment.ambiguities,
                userId,
                noteId
              );
              results.clarificationsSent += sent;
            } catch (err) {
              console.warn(`[ENRICH] Failed to send clarification:`, err);
            }
          }
        }

        if (enrichment.tags.length > 0) {
          const currentTags = item.tags || [];
          const newTags = [...new Set([...currentTags, ...enrichment.tags])];
          if (newTags.length > currentTags.length) {
            await sql`UPDATE notes SET tags = ${newTags} WHERE id = ${noteId}`;
          }
        }

        results.processed++;
        results.enriched++;
        successfulQueueIds.push(item.queueId);
      } catch (error) {
        const msg = `${noteId}: ${error instanceof Error ? error.message : "Unknown"}`;
        results.errors.push(msg);
        await failQueueItem(item.queueId, msg);
      }
    }

    if (successfulQueueIds.length > 0) {
      await completeQueueItems(successfulQueueIds);
    }

    const batchInput = claimed.map((item) => ({
      id: item.noteId,
      title: item.title,
      content: item.content,
      userId: item.userId,
    }));

    const embeddings = await batchGenerateEmbeddings(batchInput);
    for (const [noteId, embedding] of embeddings) {
      try {
        await sql`
          UPDATE notes
          SET embedding = ${JSON.stringify(embedding)}::vector,
              indexed_at = NOW()
          WHERE id = ${noteId}
        `;
        results.embedded++;
      } catch (err) {
        console.warn(`[ENRICH] Failed to save embedding for ${noteId}:`, err);
      }
    }

    const duration = Date.now() - startTime;
    const remainingResult = await sql`
      SELECT COUNT(*) as count FROM notes WHERE enriched_at IS NULL
    `;
    const remaining = parseInt((remainingResult[0] as { count: string })?.count || "0", 10);
    const queueAfter = await getQueueStats();

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      duration: `${duration}ms`,
      ...results,
      remainingNotes: remaining,
      queueBefore,
      queueAfter,
      estimatedHoursToCompleteAtCurrentBatch: Math.ceil((remaining / Math.max(BATCH_SIZE, 1)) / 12),
    });
  } catch (error) {
    console.error("[ENRICH] Fatal error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown" },
      { status: 500 }
    );
  }
}
