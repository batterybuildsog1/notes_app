/**
 * Vercel Cron - Batch Entity Enrichment
 * Runs every 5 minutes to process queued notes in batches
 *
 * Hybrid approach:
 * - Clarity check happens immediately on note create (for fast Telegram questions)
 * - Entity extraction is batched here (reduces Grok API calls by ~50%)
 *
 * Protected by CRON_SECRET header
 */

import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import {
  claimEnrichmentBatch,
  completeQueueItems,
  failQueueItem,
  resetStaleQueueItems,
  getQueueStats,
  updateNoteEmbedding,
} from "@/lib/db";
import { linkEntitiesToNote, entitiesToTags } from "@/lib/entity-extraction";
import {
  batchExtractEntities,
  batchGenerateEmbeddings,
} from "@/lib/batch-enrichment";

export const runtime = "edge";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes max

const sql = neon(process.env.DATABASE_URL!);

const BATCH_SIZE = 15; // Notes per batch (optimal for Grok response size)

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
    embedded: 0,
    linked: { people: 0, companies: 0, projects: 0 },
    errors: [] as string[],
    staleReset: 0,
  };

  try {
    // Reset any stale processing items (stuck for >10 min)
    results.staleReset = await resetStaleQueueItems();
    if (results.staleReset > 0) {
      console.log(`[ENRICH-BATCH] Reset ${results.staleReset} stale queue items`);
    }

    // Claim a batch of notes for processing
    const batch = await claimEnrichmentBatch(BATCH_SIZE);

    if (batch.length === 0) {
      const stats = await getQueueStats();
      return NextResponse.json({
        ok: true,
        message: "No notes to process",
        queueStats: stats,
        duration: `${Date.now() - startTime}ms`,
      });
    }

    console.log(`[ENRICH-BATCH] Processing ${batch.length} notes`);

    // Prepare batch input
    const batchInput = batch.map((item) => ({
      id: item.noteId,
      title: item.title,
      content: item.content,
    }));

    // Run batch entity extraction + embeddings in parallel
    const [entitiesMap, embeddingsMap] = await Promise.all([
      batchExtractEntities(batchInput),
      batchGenerateEmbeddings(batchInput),
    ]);

    // Process each note with its extracted entities
    const completedQueueIds: string[] = [];

    for (const item of batch) {
      try {
        const entities = entitiesMap.get(item.noteId);
        const embedding = embeddingsMap.get(item.noteId);

        if (!entities) {
          console.warn(`[ENRICH-BATCH] No entities for note ${item.noteId}`);
          await failQueueItem(item.queueId, "No entities extracted");
          results.errors.push(`Note ${item.noteId}: No entities extracted`);
          continue;
        }

        // Build updates
        const updates: { tags?: string[]; project?: string; title?: string } = {};
        const entityTags = entitiesToTags(entities);

        // Merge with existing tags
        const existingTags = item.tags || [];
        const allTags = new Set([...existingTags, ...entityTags]);
        if (allTags.size > existingTags.length) {
          updates.tags = Array.from(allTags);
        }

        // Apply project if found
        if (entities.project) {
          updates.project = entities.project;
        }

        // Apply auto-title if suggested and current title is vague
        if (entities.suggestedTitle) {
          const isUntitled =
            !item.title ||
            item.title.toLowerCase() === "untitled" ||
            item.title.trim().length < 3;
          if (isUntitled) {
            updates.title = entities.suggestedTitle;
            results.titled++;
          }
        }

        // Link entities to note (CRM-style)
        try {
          const linked = await linkEntitiesToNote(
            item.noteId,
            item.userId,
            entities
          );
          results.linked.people += linked.people.length;
          results.linked.companies += linked.companies.length;
          results.linked.projects += linked.projects.length;
        } catch (linkErr) {
          console.warn(
            `[ENRICH-BATCH] Entity linking failed for note ${item.noteId}:`,
            linkErr
          );
        }

        // Apply updates to note
        if (updates.tags || updates.project || updates.title) {
          await sql`
            UPDATE notes
            SET
              tags = COALESCE(${updates.tags || null}::text[], tags),
              project = COALESCE(${updates.project || null}, project),
              title = COALESCE(${updates.title || null}, title),
              enriched_at = NOW(),
              updated_at = NOW()
            WHERE id = ${item.noteId}
          `;
          results.enriched++;
        } else {
          // Mark as enriched even if no changes
          await sql`
            UPDATE notes SET enriched_at = NOW() WHERE id = ${item.noteId}
          `;
        }

        // Store embedding
        if (embedding) {
          await updateNoteEmbedding(item.noteId, embedding);
          results.embedded++;
        }

        results.processed++;
        completedQueueIds.push(item.queueId);
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : "Unknown error";
        results.errors.push(`Note ${item.noteId}: ${errorMsg}`);
        await failQueueItem(item.queueId, errorMsg);
      }
    }

    // Mark completed items
    if (completedQueueIds.length > 0) {
      await completeQueueItems(completedQueueIds);
    }

    const duration = Date.now() - startTime;
    const stats = await getQueueStats();

    console.log(
      `[ENRICH-BATCH] Completed: ${results.enriched}/${results.processed} enriched in ${duration}ms`
    );

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      duration: `${duration}ms`,
      ...results,
      queueStats: stats,
    });
  } catch (error) {
    console.error("[ENRICH-BATCH] Error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
