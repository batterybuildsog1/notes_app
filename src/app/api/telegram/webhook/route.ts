/**
 * Telegram Bot Webhook Handler
 * - Chats with Grok (with full notes app context)
 * - Handles clarification responses for enrichment
 * - Responds to commands
 */

import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

export const runtime = "edge";
export const dynamic = "force-dynamic";

const DEFAULT_USER_ID = "3d866169-c8db-4d46-beef-dd6fc4daa930";

function getAllowedChatIds(): Set<string> {
  const ids = new Set<string>();
  const primary = process.env.TELEGRAM_CHAT_ID;
  const extra = process.env.TELEGRAM_CHAT_IDS;

  if (primary) ids.add(primary.trim());
  if (extra) {
    for (const id of extra.split(",")) {
      const v = id.trim();
      if (v) ids.add(v);
    }
  }

  return ids;
}

async function isDuplicateUpdate(updateId?: number): Promise<boolean> {
  if (typeof updateId !== "number") return false;

  try {
    const rows = await sql`
      SELECT value FROM key_value WHERE key = 'telegram_last_update_id'
    `;
    if (rows.length === 0) return false;

    const last = parseInt((rows[0] as { value: string }).value || "0", 10);
    return Number.isFinite(last) && updateId <= last;
  } catch {
    return false;
  }
}

async function markUpdateProcessed(updateId?: number): Promise<void> {
  if (typeof updateId !== "number") return;

  try {
    await sql`
      INSERT INTO key_value (key, value, updated_at)
      VALUES ('telegram_last_update_id', ${updateId.toString()}, NOW())
      ON CONFLICT (key)
      DO UPDATE SET value = ${updateId.toString()}, updated_at = NOW()
    `;
  } catch {
    // non-fatal
  }
}

const GROK_SYSTEM_PROMPT = `You are Alan's Notes Assistant for notes.sunhomes.io.

Rules (strict):
1) Be concise, concrete, and useful. No fluff.
2) Do NOT ask speculative clarification questions.
3) Ask at most ONE clarification question only when blocked from answering, and make it specific.
4) Prefer giving a best-effort answer with what you know.
5) If uncertain, say what is unknown in one line.
6) Never invent facts, people, projects, or statuses.

Primary jobs:
- Answer Alan's questions about his notes and projects.
- Give clear status on sync/enrichment health when asked.
- Acknowledge “remember this” messages briefly.

Tone:
- Calm, practical, direct.
- Short paragraphs or bullets.
`;

/**
 * Handle incoming Telegram webhook
 */
export async function POST(request: NextRequest) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const xaiApiKey = process.env.XAI_API_KEY;

  // Verify webhook secret
  if (webhookSecret) {
    const providedSecret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (providedSecret !== webhookSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  if (!botToken) {
    return NextResponse.json({ error: "Bot not configured" }, { status: 500 });
  }

  try {
    const update = await request.json() as {
      update_id?: number;
      message?: {
        chat: { id: number };
        text?: string;
        message_id?: number;
        reply_to_message?: { message_id?: number };
      };
      edited_message?: {
        chat: { id: number };
        text?: string;
        message_id?: number;
        reply_to_message?: { message_id?: number };
      };
    };

    if (await isDuplicateUpdate(update.update_id)) {
      return NextResponse.json({ ok: true });
    }

    const message = update.message || update.edited_message;

    if (!message?.text) {
      await markUpdateProcessed(update.update_id);
      return NextResponse.json({ ok: true });
    }

    const chatId = message.chat.id;
    const text = message.text.trim();
    const replyTo = message.reply_to_message;

    // Verify authorized chat(s)
    const allowedChatIds = getAllowedChatIds();
    if (allowedChatIds.size > 0 && !allowedChatIds.has(chatId.toString())) {
      console.log(`[WEBHOOK] Ignoring message from unauthorized chat: ${chatId}`);
      await markUpdateProcessed(update.update_id);
      return NextResponse.json({ ok: true });
    }

    console.log(`[WEBHOOK] Received: "${text.slice(0, 50)}..."`);

    // 1. Handle commands
    if (text.startsWith("/")) {
      const res = await handleCommand(text, chatId, botToken);
      await markUpdateProcessed(update.update_id);
      return res;
    }

    // 2. Handle clarification replies deterministically (no regex guessing)
    if (replyTo?.message_id) {
      try {
        const byTelegramId = await sql`
          SELECT id, note_id, question
          FROM clarifications
          WHERE telegram_message_id = ${replyTo.message_id}
            AND status = 'pending'
            AND user_id = ${DEFAULT_USER_ID}
          ORDER BY created_at DESC
          LIMIT 1
        `;

        const fallbackPending = byTelegramId.length > 0
          ? byTelegramId
          : await sql`
              SELECT id, note_id, question
              FROM clarifications
              WHERE status = 'pending'
                AND user_id = ${DEFAULT_USER_ID}
              ORDER BY created_at DESC
              LIMIT 1
            `;

        if (fallbackPending.length > 0) {
          const clarification = fallbackPending[0] as { id: string; note_id: string; question: string };

          await sql`
            UPDATE clarifications
            SET answer = ${text},
                status = 'answered',
                answered_at = NOW()
            WHERE id = ${clarification.id}
          `;

          await sendMessage(
            chatId,
            `Thanks — saved your clarification for note ${clarification.note_id}.`,
            botToken
          );
          await markUpdateProcessed(update.update_id);
          return NextResponse.json({ ok: true });
        }
      } catch (e) {
        console.warn("[WEBHOOK] Failed handling clarification reply:", e);
      }
    }

    // 3. Chat with Grok
    if (!xaiApiKey) {
      await sendMessage(chatId, "Grok not configured. Set XAI_API_KEY.", botToken);
      await markUpdateProcessed(update.update_id);
      return NextResponse.json({ ok: true });
    }

    // Store user message in memory
    try {
      await sql`
        INSERT INTO telegram_messages (chat_id, role, content)
        VALUES (${chatId}, 'user', ${text})
      `;
    } catch (e) {
      console.warn("[WEBHOOK] Failed to store user message:", e);
    }

    // Load conversation history (last 20 messages)
    let conversationHistory: Array<{role: string, content: string}> = [];
    try {
      const history = await sql`
        SELECT role, content FROM telegram_messages
        WHERE chat_id = ${chatId}
        ORDER BY created_at DESC
        LIMIT 20
      `;
      // Reverse to get chronological order (oldest first)
      conversationHistory = (
        history as Array<{ role: string; content: string }>
      ).reverse().map((h) => ({
        role: h.role,
        content: h.content,
      }));
    } catch (e) {
      console.warn("[WEBHOOK] Failed to load history:", e);
    }

    // Get enrichment stats
    const statsResult = await sql`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE enriched_at IS NOT NULL) as enriched,
        COUNT(*) FILTER (WHERE enriched_at IS NULL) as pending
      FROM notes
    `;
    const stats = statsResult[0] as { total: string; enriched: string; pending: string };
    const totalNotes = parseInt(stats.total || "0", 10);
    const enrichedNotes = parseInt(stats.enriched || "0", 10);
    const pendingNotes = parseInt(stats.pending || "0", 10);
    const enrichedPct = totalNotes > 0 ? Math.round((enrichedNotes / totalNotes) * 100) : 0;

    // Get recent notes for context
    const recentNotes = await sql`
      SELECT title, content, tags, project, ai_summary FROM notes
      WHERE user_id = ${DEFAULT_USER_ID}
      ORDER BY updated_at DESC
      LIMIT 10
    `;

    const notesContext = recentNotes.length > 0
      ? (recentNotes as Array<{
          title: string;
          content: string;
          tags: string[] | null;
          project: string | null;
          ai_summary: string | null;
        }>).map((n) => {
          const parsedSummary = n.ai_summary
            ? (JSON.parse(n.ai_summary) as { oneLiner?: string })
            : null;
          const summary = parsedSummary?.oneLiner || null;
          return `- "${n.title}" ${n.project ? `[${n.project}]` : ''}: ${summary || `${(n.content || '').slice(0, 80)}...`}`;
        }).join('\n')
      : "No recent notes.";

    const pendingClarificationsResult = await sql`
      SELECT COUNT(*) as count
      FROM clarifications
      WHERE status = 'pending'
        AND user_id = ${DEFAULT_USER_ID}
    `;
    const pendingClarifications = parseInt(
      (pendingClarificationsResult[0] as { count: string }).count || '0',
      10
    );

    const dynamicContext = `
## Current Status
- Total notes: ${totalNotes}
- Enriched: ${enrichedNotes} (${enrichedPct}%)
- Pending enrichment: ${pendingNotes}
- Pending clarifications: ${pendingClarifications}

## Recent Notes
${notesContext}
`;

    const fullSystemPrompt = GROK_SYSTEM_PROMPT + dynamicContext;

    try {
      // Build messages array with conversation history
      const messages: Array<{role: string, content: string}> = [
        { role: "system", content: fullSystemPrompt }
      ];

      // Add conversation history (excluding the current message which is already in history)
      // Take all but the last message (current one) to avoid duplication
      const historyWithoutCurrent = conversationHistory.slice(0, -1);
      for (const msg of historyWithoutCurrent) {
        messages.push({ role: msg.role, content: msg.content });
      }

      // Add current user message
      messages.push({ role: "user", content: text });

      const chatModel = process.env.TELEGRAM_BOT_MODEL || "grok-4-1-fast-reasoning";

      const grokResponse = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${xaiApiKey}`,
        },
        body: JSON.stringify({
          model: chatModel,
          messages,
          max_tokens: 450,
          temperature: 0.2,
        }),
      });

      if (!grokResponse.ok) {
        const errText = await grokResponse.text();
        console.error("[WEBHOOK] Grok error:", errText);
        await sendMessage(chatId, "Grok is unavailable right now. Try again later.", botToken);
        await markUpdateProcessed(update.update_id);
        return NextResponse.json({ ok: true });
      }

      const grokData = await grokResponse.json();
      const reply = grokData.choices?.[0]?.message?.content || "No response from Grok.";

      // Store Grok's reply in memory
      try {
        await sql`
          INSERT INTO telegram_messages (chat_id, role, content)
          VALUES (${chatId}, 'assistant', ${reply})
        `;
      } catch (e) {
        console.warn("[WEBHOOK] Failed to store assistant message:", e);
      }

      await sendMessage(chatId, reply, botToken);
      console.log(`[WEBHOOK] Grok replied (${conversationHistory.length} msgs in history): "${reply.slice(0, 50)}..."`);

    } catch (err) {
      console.error("[WEBHOOK] Grok call failed:", err);
      await sendMessage(chatId, "Failed to reach Grok. Try again.", botToken);
    }

    await markUpdateProcessed(update.update_id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[WEBHOOK] Error:", error);
    return NextResponse.json({ ok: true }); // Always return 200 to Telegram
  }
}

/**
 * Handle bot commands
 */
async function handleCommand(text: string, chatId: number, botToken: string) {
  const command = text.split(" ")[0].toLowerCase();

  switch (command) {
    case "/start":
      await sendMessage(chatId,
        "Hey! I'm Grok, your Notes assistant.\n\n" +
        "I power the AI enrichment for notes.sunhomes.io and I'm here to chat.\n\n" +
        "Ask me about your notes, projects, or enrichment status. I also handle clarification questions when I'm uncertain about people/companies in your notes.\n\n" +
        "Commands: /help, /status, /issues",
        botToken
      );
      break;

    case "/help":
      await sendMessage(chatId,
        "Commands:\n" +
        "/start - Welcome\n" +
        "/help - This help\n" +
        "/status - Enrichment progress\n" +
        "/issues - Find problems\n" +
        "/memory - Check conversation memory\n" +
        "/clear - Clear conversation history\n\n" +
        "I remember our conversation! Just chat naturally.",
        botToken
      );
      break;

    case "/status": {
      const stats = await getStats();
      const queue = await sql`
        SELECT
          COUNT(*) FILTER (WHERE status = 'pending') as pending,
          COUNT(*) FILTER (WHERE status = 'processing') as processing,
          COUNT(*) FILTER (WHERE status = 'failed') as failed
        FROM enrichment_queue
      `;
      const q = queue[0] as { pending: string; processing: string; failed: string };
      await sendMessage(chatId,
        `Enrichment Status\n\n` +
        `Total notes: ${stats.total}\n` +
        `Enriched: ${stats.enriched} (${stats.percent}%)\n` +
        `Pending enrichment: ${stats.pending}\n\n` +
        `Queue pending: ${q.pending}\n` +
        `Queue processing: ${q.processing}\n` +
        `Queue failed: ${q.failed}\n\n` +
        `Cron schedule: every 5 minutes.`,
        botToken
      );
      break;
    }

    case "/issues":
      const issues = await getIssues();
      await sendMessage(chatId, issues, botToken);
      break;

    case "/clear":
      try {
        await sql`DELETE FROM telegram_messages WHERE chat_id = ${chatId}`;
        await sendMessage(chatId, "Memory cleared! Starting fresh.", botToken);
      } catch {
        await sendMessage(chatId, "Failed to clear memory.", botToken);
      }
      break;

    case "/memory":
      try {
        const countResult = await sql`
          SELECT COUNT(*) as count FROM telegram_messages WHERE chat_id = ${chatId}
        `;
        const count = (countResult[0] as { count: string } | undefined)?.count || 0;
        await sendMessage(chatId, `Memory: ${count} messages stored.\n\nUse /clear to reset.`, botToken);
      } catch {
        await sendMessage(chatId, "Memory: Unable to check.", botToken);
      }
      break;

    default:
      await sendMessage(chatId, "Unknown command. Try /help or just chat with me!", botToken);
  }

  return NextResponse.json({ ok: true });
}

/**
 * Send message to Telegram
 */
async function sendMessage(chatId: number, text: string, botToken: string) {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text })
    });
  } catch (err) {
    console.error("[WEBHOOK] Send failed:", err);
  }
}

/**
 * Get enrichment stats
 */
async function getStats() {
  const result = await sql`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE enriched_at IS NOT NULL) as enriched
    FROM notes
  `;
  const row = result[0] as { total: string; enriched: string } | undefined;
  const total = parseInt(row?.total || "0", 10);
  const enriched = parseInt(row?.enriched || "0", 10);

  return {
    total,
    enriched,
    pending: total - enriched,
    percent: total > 0 ? Math.round((enriched / total) * 100) : 0
  };
}

/**
 * Get issues report
 */
async function getIssues() {
  const noTags = await sql`SELECT COUNT(*) as c FROM notes WHERE tags IS NULL OR array_length(tags, 1) IS NULL`;
  const noCategory = await sql`SELECT COUNT(*) as c FROM notes WHERE category IS NULL`;
  const stalled = await sql`
    SELECT COUNT(*) as c FROM notes
    WHERE enriched_at IS NULL
    AND created_at < NOW() - INTERVAL '48 hours'
  `;

  const noTagsCount = (noTags[0] as { c: string } | undefined)?.c || 0;
  const noCategoryCount = (noCategory[0] as { c: string } | undefined)?.c || 0;
  const stalledCount = (stalled[0] as { c: string } | undefined)?.c || 0;

  if (noTagsCount === 0 && noCategoryCount === 0 && stalledCount === 0) {
    return "No issues found! Everything looks good.";
  }

  return `Issues Found:\n\n` +
    `- Notes without tags: ${noTagsCount}\n` +
    `- Notes without category: ${noCategoryCount}\n` +
    `- Stalled enrichment (>48h): ${stalledCount}`;
}

// GET endpoint to check webhook status
export async function GET() {
  return NextResponse.json({
    status: "active",
    message: "Notes assistant webhook",
    model: process.env.TELEGRAM_BOT_MODEL || "grok-4-1-fast-reasoning",
  });
}
