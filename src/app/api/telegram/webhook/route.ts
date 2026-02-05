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

const GROK_SYSTEM_PROMPT = `You are Grok, Alan's Notes Assistant for notes.sunhomes.io.

## Your Identity
- You are the AI powering the notes app enrichment and this Telegram chat
- You run on the xAI Grok API
- You're helpful, concise, and proactive about the notes system

## The Notes App (notes.sunhomes.io)
A personal knowledge base that stores Alan's notes, synced from Notion.

**Features:**
- Notes with title, content, tags, category, project
- AI enrichment that extracts summaries, people, companies, action items
- Semantic search via embeddings
- Knowledge graph linking people/companies to notes

## Your Enrichment Role
You run daily at 7 AM UTC via a cron job that:
1. Fetches unenriched notes (batch of 75)
2. Extracts AI summaries with: oneLiner, keyPoints, peopleAndRoles, companiesMentioned, nextSteps, sentiment
3. Links people/companies to notes in the database
4. Creates action items from nextSteps
5. Sends Telegram clarifications when entities are ambiguous (e.g., "Which Ryan? Kimball or someone else?")

**When you ask for clarification**, I store the response and use it to improve future enrichments.

## Available API Endpoints
- GET /api/health - Health check
- GET /api/notes - List notes
- GET /api/notes/:id - Get single note
- GET /api/notes/stats - Stats and recent activity
- POST /api/notes/semantic-search - Search by meaning
- GET /api/issues - Find problems (missing tags, stalled enrichment)
- POST /api/cron/daily - Trigger enrichment manually

## Current Schedule
- **Daily enrichment**: 7 AM UTC (cron job)
- **Batch size**: 75 notes per run
- At current rate, ~13 days to process full backlog

## What You Can Help With
1. **Answer questions** about notes, people, projects mentioned in them
2. **Explain enrichment status** - how many processed, pending, errors
3. **Help find information** - "What notes mention Isaac?" or "What's the status of TechRidge?"
4. **Create quick notes** - If asked to remember something, acknowledge it
5. **Clarify ambiguities** - When user replies to a clarification question
6. **Proactively notify** - If you notice issues (like enrichment stalled), mention it

## Communication Style
- Be concise but helpful
- Use the recent notes context provided to answer questions
- If you don't know something specific, say so
- You can ask clarifying questions when needed

## Current Context
The user is Alan. He manages multiple projects including real estate (SunHomes, TechRidge), investments (MoneyHeaven), and various business contacts.
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
    const update = await request.json();
    const message = update.message;

    if (!message?.text) {
      return NextResponse.json({ ok: true });
    }

    const chatId = message.chat.id;
    const text = message.text.trim();
    const replyTo = message.reply_to_message;

    // Verify authorized chat
    const authorizedChatId = process.env.TELEGRAM_CHAT_ID;
    if (authorizedChatId && chatId.toString() !== authorizedChatId) {
      console.log(`[WEBHOOK] Ignoring message from unauthorized chat: ${chatId}`);
      return NextResponse.json({ ok: true });
    }

    console.log(`[WEBHOOK] Received: "${text.slice(0, 50)}..."`);

    // 1. Handle commands
    if (text.startsWith("/")) {
      return handleCommand(text, chatId, botToken);
    }

    // 2. Handle clarification replies
    if (replyTo?.text?.includes("Clarification") || replyTo?.text?.includes("clarification") || replyTo?.text?.includes("Which")) {
      const entityMatch = replyTo.text.match(/about\s+"([^"]+)"/i) ||
                          replyTo.text.match(/Which\s+(\w+)\?/i) ||
                          replyTo.text.match(/Issue:\s*(.+)/i);
      if (entityMatch) {
        const ambiguousEntity = entityMatch[1].trim();

        // Store clarification
        try {
          await sql`
            INSERT INTO entity_clarifications (ambiguous_entity, resolved_to, created_at)
            VALUES (${ambiguousEntity}, ${text}, NOW())
            ON CONFLICT DO NOTHING
          `;
          console.log(`[WEBHOOK] Stored clarification: "${ambiguousEntity}" -> "${text}"`);
        } catch (e) {
          console.warn("[WEBHOOK] Failed to store clarification:", e);
        }

        await sendMessage(chatId, `Got it! I'll remember that "${ambiguousEntity}" refers to "${text}". This will help with future note enrichment.`, botToken);
        return NextResponse.json({ ok: true });
      }
    }

    // 3. Chat with Grok
    if (!xaiApiKey) {
      await sendMessage(chatId, "Grok not configured. Set XAI_API_KEY.", botToken);
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
      conversationHistory = (history as any[]).reverse().map(h => ({
        role: h.role,
        content: h.content
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
    const stats = statsResult[0] as any;

    // Get recent notes for context
    const recentNotes = await sql`
      SELECT title, content, tags, project, ai_summary FROM notes
      WHERE user_id = ${DEFAULT_USER_ID}
      ORDER BY updated_at DESC
      LIMIT 10
    `;

    const notesContext = recentNotes.length > 0
      ? recentNotes.map((n: any) => {
          const summary = n.ai_summary ? JSON.parse(n.ai_summary)?.oneLiner : null;
          return `- "${n.title}" ${n.project ? `[${n.project}]` : ''}: ${summary || n.content?.slice(0, 80) + '...'}`;
        }).join('\n')
      : "No recent notes.";

    // Get pending clarifications (table may not exist yet)
    let pendingClarifications: any[] = [];
    try {
      pendingClarifications = await sql`
        SELECT ambiguous_entity, context FROM enrichment_clarifications
        WHERE status = 'pending'
        ORDER BY created_at DESC
        LIMIT 3
      `;
    } catch {
      // Table doesn't exist yet, skip
    }

    const clarificationsContext = pendingClarifications.length > 0
      ? `\n\n**Pending clarifications I need:**\n${pendingClarifications.map((c: any) => `- "${c.ambiguous_entity}": ${c.context || 'Who/what is this?'}`).join('\n')}`
      : '';

    const dynamicContext = `
## Current Status
- Total notes: ${stats.total}
- Enriched: ${stats.enriched} (${Math.round((stats.enriched / stats.total) * 100)}%)
- Pending: ${stats.pending}
${clarificationsContext}

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

      const grokResponse = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${xaiApiKey}`,
        },
        body: JSON.stringify({
          model: "grok-4-1-fast-reasoning",
          messages,
          max_tokens: 800,
        }),
      });

      if (!grokResponse.ok) {
        const errText = await grokResponse.text();
        console.error("[WEBHOOK] Grok error:", errText);
        await sendMessage(chatId, "Grok is unavailable right now. Try again later.", botToken);
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

    case "/status":
      const stats = await getStats();
      const daysRemaining = Math.ceil(stats.pending / 75);
      await sendMessage(chatId,
        `Enrichment Status\n\n` +
        `Total: ${stats.total}\n` +
        `Enriched: ${stats.enriched} (${stats.percent}%)\n` +
        `Pending: ${stats.pending}\n\n` +
        `At 75/day, ~${daysRemaining} days to complete.\n` +
        `Next run: 7 AM UTC daily`,
        botToken
      );
      break;

    case "/issues":
      const issues = await getIssues();
      await sendMessage(chatId, issues, botToken);
      break;

    case "/clear":
      try {
        await sql`DELETE FROM telegram_messages WHERE chat_id = ${chatId}`;
        await sendMessage(chatId, "Memory cleared! Starting fresh.", botToken);
      } catch (e) {
        await sendMessage(chatId, "Failed to clear memory.", botToken);
      }
      break;

    case "/memory":
      try {
        const countResult = await sql`
          SELECT COUNT(*) as count FROM telegram_messages WHERE chat_id = ${chatId}
        `;
        const count = (countResult[0] as any)?.count || 0;
        await sendMessage(chatId, `Memory: ${count} messages stored.\n\nUse /clear to reset.`, botToken);
      } catch (e) {
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
  const row = result[0] as any;
  const total = parseInt(row?.total || "0");
  const enriched = parseInt(row?.enriched || "0");

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

  const noTagsCount = (noTags[0] as any)?.c || 0;
  const noCategoryCount = (noCategory[0] as any)?.c || 0;
  const stalledCount = (stalled[0] as any)?.c || 0;

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
    message: "Grok-powered webhook",
    model: "grok-4-1-fast-reasoning"
  });
}
