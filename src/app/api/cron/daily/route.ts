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
} from "@/lib/batch-enrichment";

export const runtime = "edge";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes max

const sql = neon(process.env.DATABASE_URL!);

// Process more notes since we only run once per day
const BATCH_SIZE = 75; // ~13 days to process 976 notes

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
    errors: [] as string[],
  };

  try {
    console.log(`[ENRICH] Starting daily enrichment run, batch size: ${BATCH_SIZE}`);

    // Get batch of notes to enrich
    const batch = await sql`
      SELECT 
        n.id as note_id,
        n.title,
        n.content,
        n.user_id,
        n.tags,
        n.project
      FROM notes n
      LEFT JOIN enrichment_queue eq ON eq.note_id = n.id
      WHERE n.enriched_at IS NULL
        AND (eq.status IS NULL OR eq.status = 'pending')
        AND n.created_at < NOW() - INTERVAL '1 hour'  -- Don't enrich brand new notes
      ORDER BY n.created_at ASC
      LIMIT ${BATCH_SIZE}
    `;

    if (batch.length === 0) {
      return NextResponse.json({ 
        ok: true, 
        message: "No notes to process",
        timestamp: new Date().toISOString()
      });
    }

    console.log(`[ENRICH] Processing ${batch.length} notes`);
    const userId = (batch[0] as any).user_id;

    // Prepare input
    const batchInput = batch.map(item => ({
      id: (item as any).note_id,
      title: (item as any).title,
      content: (item as any).content,
      userId: (item as any).user_id,
    }));

    // Run enrichment
    const enrichments = await batchExtractEnrichments(batchInput);
    
    // Process each note
    for (const item of batch) {
      const noteId = (item as any).note_id;
      const enrichment = enrichments.get(noteId);

      if (!enrichment) {
        results.errors.push(`${noteId}: No enrichment extracted`);
        continue;
      }

      try {
        // 1. Save AI summary
        await sql`
          UPDATE notes
          SET 
            ai_summary = ${JSON.stringify(enrichment.summary)},
            summary_generated_at = NOW(),
            enriched_at = NOW(),
            updated_at = NOW()
          WHERE id = ${noteId}
        `;

        // 2. Link people to note (THE FIX)
        for (const [personName, role] of Object.entries(enrichment.summary.peopleAndRoles)) {
          try {
            const person = await findOrCreatePerson(userId, personName);
            await linkPersonToNote(noteId, person.id, role as string);
            results.peopleLinked++;
          } catch (err) {
            console.warn(`[ENRICH] Failed to link person ${personName}:`, err);
          }
        }

        // 3. Create action items from nextSteps (THE FIX)
        for (const step of enrichment.summary.nextSteps) {
          try {
            await createActionItem(noteId, userId, step, 'ai_extracted');
            results.actionItemsCreated++;
          } catch (err) {
            console.warn(`[ENRICH] Failed to create action item:`, err);
          }
        }

        // 4. Send clarifications if needed (THE FIX)
        if (enrichment.ambiguities.length > 0) {
          try {
            await sendTelegramClarification(
              (item as any).title || 'Untitled Note',
              enrichment.ambiguities,
              userId
            );
            results.clarificationsSent += enrichment.ambiguities.length;
          } catch (err) {
            console.warn(`[ENRICH] Failed to send clarification:`, err);
          }
        }

        // 5. Update tags if needed
        if (enrichment.tags.length > 0) {
          const currentTags = (item as any).tags || [];
          const newTags = [...new Set([...currentTags, ...enrichment.tags])];
          if (newTags.length > currentTags.length) {
            await sql`UPDATE notes SET tags = ${newTags} WHERE id = ${noteId}`;
          }
        }

        results.processed++;
        results.enriched++;
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown";
        results.errors.push(`${noteId}: ${msg}`);
      }
    }

    // Generate embeddings (optional, can be done separately)
    const embeddings = await batchGenerateEmbeddings(batchInput);
    for (const [noteId, embedding] of embeddings) {
      try {
        await sql`
          UPDATE notes 
          SET embedding = ${JSON.stringify(embedding)}::vector
          WHERE id = ${noteId}
        `;
        results.embedded++;
      } catch (err) {
        console.warn(`[ENRICH] Failed to save embedding for ${noteId}:`, err);
      }
    }

    const duration = Date.now() - startTime;
    
    // Get remaining count
    const remainingResult = await sql`
      SELECT COUNT(*) as count FROM notes WHERE enriched_at IS NULL
    `;
    const remaining = parseInt((remainingResult[0] as any)?.count || "0");

    console.log(
      `[ENRICH] Daily run complete: ${results.enriched}/${results.processed} enriched, ` +
      `${results.peopleLinked} people linked, ${results.actionItemsCreated} actions, ` +
      `${results.clarificationsSent} clarifications, ${remaining} remaining, ${duration}ms`
    );

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      duration: `${duration}ms`,
      ...results,
      remainingNotes: remaining,
      estimatedDaysToComplete: Math.ceil(remaining / BATCH_SIZE),
    });

  } catch (error) {
    console.error("[ENRICH] Fatal error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown" },
      { status: 500 }
    );
  }
}
