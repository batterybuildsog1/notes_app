/**
 * Vercel Cron - Telegram Reply Polling
 * Runs every 5 minutes to check for replies to clarification questions
 *
 * Protected by CRON_SECRET header
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getUpdates,
  getLastUpdateId,
  setLastUpdateId,
  sendTelegramMessage,
} from "@/lib/telegram";
import {
  getClarificationByTelegramMessageId,
  getMostRecentPendingClarification,
  answerClarification,
  getNoteByIdInternal,
  updateNote,
  markClarificationApplied,
  updateNoteEmbedding,
} from "@/lib/db";
import {
  extractEntitiesWithContext,
  linkEntitiesToNote,
  entitiesToTags,
} from "@/lib/entity-extraction";
import { generateEmbedding } from "@/lib/enrichment";
import { neon } from "@neondatabase/serverless";

export const runtime = "edge";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // 1 minute max

const DEFAULT_USER_ID = "3d866169-c8db-4d46-beef-dd6fc4daa930";

interface ProcessedReply {
  updateId: number;
  messageId: number;
  noteId: string;
  noteTitle: string;
  context: string;
  success: boolean;
  error?: string;
}

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();
  const results: ProcessedReply[] = [];

  try {
    // Get last processed update_id
    const lastUpdateId = await getLastUpdateId();
    const offset = lastUpdateId ? lastUpdateId + 1 : undefined;

    console.log(`[TELEGRAM POLL] Checking updates from offset: ${offset || "beginning"}`);

    // Fetch new updates
    const updates = await getUpdates(offset);

    if (updates.length === 0) {
      return NextResponse.json({
        ok: true,
        timestamp: new Date().toISOString(),
        message: "No new updates",
        processed: 0,
      });
    }

    console.log(`[TELEGRAM POLL] Found ${updates.length} new updates`);

    let maxUpdateId = lastUpdateId || 0;

    for (const update of updates) {
      // Track highest update_id for next poll
      if (update.update_id > maxUpdateId) {
        maxUpdateId = update.update_id;
      }

      const message = update.message;
      if (!message?.text) {
        continue;
      }

      // Try to find matching clarification
      let clarification = null;
      let matchMethod = "";

      // Method 1: Direct reply matching (reply_to_message_id)
      if (message.reply_to_message?.message_id) {
        clarification = await getClarificationByTelegramMessageId(
          message.reply_to_message.message_id
        );
        if (clarification) {
          matchMethod = "reply_to_message";
        }
      }

      // Method 2: Fallback to most recent pending clarification
      if (!clarification) {
        clarification = await getMostRecentPendingClarification(DEFAULT_USER_ID);
        if (clarification) {
          matchMethod = "most_recent_pending";
        }
      }

      if (!clarification) {
        console.log(`[TELEGRAM POLL] No matching clarification for message: "${message.text.slice(0, 50)}..."`);
        continue;
      }

      // Process the clarification
      try {
        const note = await getNoteByIdInternal(clarification.note_id);
        if (!note) {
          results.push({
            updateId: update.update_id,
            messageId: message.message_id,
            noteId: clarification.note_id,
            noteTitle: "Unknown",
            context: message.text,
            success: false,
            error: "Note not found",
          });
          continue;
        }

        const context = message.text;

        // Update clarification with answer
        await answerClarification(clarification.note_id, context);

        // Re-run entity extraction with user context
        const entities = await extractEntitiesWithContext(
          note.title,
          note.content,
          context
        );

        // Link entities to note
        const linkedEntities = await linkEntitiesToNote(
          clarification.note_id,
          note.user_id,
          entities
        );

        // Convert entities to tags
        const entityTags = entitiesToTags(entities);

        // Build updates
        const updates: { category?: string; tags?: string[]; project?: string } = {};

        // Merge tags
        const existingTags = note.tags || [];
        const newTags = entityTags.filter((t) => !existingTags.includes(t));
        if (newTags.length > 0) {
          updates.tags = [...existingTags, ...newTags];
        }

        // Apply project if found
        if (entities.project && !note.project) {
          updates.project = entities.project;
        }

        // Update note
        if (Object.keys(updates).length > 0) {
          await updateNote(clarification.note_id, note.user_id, updates);
        }

        // Mark as enriched
        const sql = neon(process.env.DATABASE_URL!);
        await sql`UPDATE notes SET enriched_at = NOW() WHERE id = ${clarification.note_id}`;

        // Regenerate embedding with context
        try {
          const fullText = `${note.title}\n\n${note.content}\n\nContext: ${context}`;
          const embedding = await generateEmbedding(fullText);
          if (embedding) {
            await updateNoteEmbedding(clarification.note_id, embedding);
          }
        } catch {
          // Non-fatal
        }

        // Mark clarification as applied
        await markClarificationApplied(clarification.note_id);

        // Send confirmation back to Telegram
        const confirmationMessage = `Got it! Applied your context to note "${note.title}".

Linked:
- ${linkedEntities.people.length} people
- ${linkedEntities.companies.length} companies
- ${linkedEntities.projects.length} projects
${updates.tags ? `\nNew tags: ${newTags.join(", ")}` : ""}`;

        await sendTelegramMessage(confirmationMessage);

        results.push({
          updateId: update.update_id,
          messageId: message.message_id,
          noteId: clarification.note_id,
          noteTitle: note.title,
          context: message.text,
          success: true,
        });

        console.log(`[TELEGRAM POLL] Processed clarification for note "${note.title}" via ${matchMethod}`);
      } catch (error) {
        console.error(`[TELEGRAM POLL] Error processing clarification:`, error);
        results.push({
          updateId: update.update_id,
          messageId: message.message_id,
          noteId: clarification.note_id,
          noteTitle: "Unknown",
          context: message.text,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    // Update last processed update_id
    if (maxUpdateId > (lastUpdateId || 0)) {
      await setLastUpdateId(maxUpdateId);
    }

    const duration = Date.now() - startTime;

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      duration: `${duration}ms`,
      updatesChecked: updates.length,
      processed: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    });
  } catch (error) {
    console.error("[TELEGRAM POLL] Error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
