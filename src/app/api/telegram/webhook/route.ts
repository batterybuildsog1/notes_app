/**
 * Telegram Webhook - Instant message handling
 *
 * Receives messages instantly when users reply to clarification questions.
 * No polling needed - Telegram pushes updates to this endpoint.
 */

import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { sendTelegramMessage } from "@/lib/telegram";
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

export const runtime = "edge";
export const dynamic = "force-dynamic";

const DEFAULT_USER_ID = "3d866169-c8db-4d46-beef-dd6fc4daa930";

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    text?: string;
    date: number;
    chat: { id: number };
    reply_to_message?: { message_id: number };
  };
}

export async function POST(request: NextRequest) {
  // Verify webhook secret (optional but recommended)
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (webhookSecret) {
    const providedSecret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (providedSecret !== webhookSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const update: TelegramUpdate = await request.json();
    const message = update.message;

    // Only process text messages
    if (!message?.text) {
      return NextResponse.json({ ok: true });
    }

    // Verify message is from authorized chat
    const authorizedChatId = process.env.TELEGRAM_CHAT_ID;
    if (authorizedChatId && message.chat.id.toString() !== authorizedChatId) {
      console.log(`[WEBHOOK] Ignoring message from unauthorized chat: ${message.chat.id}`);
      return NextResponse.json({ ok: true });
    }

    console.log(`[WEBHOOK] Received message: "${message.text.slice(0, 50)}..."`);

    // Find matching clarification
    let clarification = null;
    let matchMethod = "";

    // Method 1: Direct reply matching
    if (message.reply_to_message?.message_id) {
      clarification = await getClarificationByTelegramMessageId(
        message.reply_to_message.message_id
      );
      if (clarification) {
        matchMethod = "reply";
      }
    }

    // Method 2: Most recent pending clarification
    if (!clarification) {
      clarification = await getMostRecentPendingClarification(DEFAULT_USER_ID);
      if (clarification) {
        matchMethod = "recent";
      }
    }

    if (!clarification) {
      console.log(`[WEBHOOK] No pending clarification found`);
      return NextResponse.json({ ok: true });
    }

    // Process the clarification
    const note = await getNoteByIdInternal(clarification.note_id);
    if (!note) {
      await sendTelegramMessage("Could not find the note for that clarification.");
      return NextResponse.json({ ok: true });
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

    // Send confirmation
    const confirmationMessage = `Applied to "${note.title}"

Linked: ${linkedEntities.people.length} people, ${linkedEntities.companies.length} companies, ${linkedEntities.projects.length} projects${newTags.length > 0 ? `\nTags: ${newTags.join(", ")}` : ""}`;

    await sendTelegramMessage(confirmationMessage);

    console.log(`[WEBHOOK] Processed clarification for "${note.title}" via ${matchMethod}`);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[WEBHOOK] Error:", error);
    return NextResponse.json({ ok: true }); // Always return 200 to Telegram
  }
}

// GET endpoint to check webhook status
export async function GET() {
  return NextResponse.json({
    status: "active",
    message: "Telegram webhook is configured",
  });
}
