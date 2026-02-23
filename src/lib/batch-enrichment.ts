/**
 * Fixed Batch Enrichment - Works with 1x/day cron
 * 
 * Changes:
 * - Larger batch size (process more notes per run)
 * - Actually save people to database and link to notes
 * - Create action items from nextSteps
 * - Send Telegram clarifications when uncertain
 * - No confidence scores - binary certain/uncertain
 */

import { trackTokenUsage, estimateTokens } from "./token-tracking";
import { generateEmbedding } from "./enrichment";
import { neon } from "@neondatabase/serverless";

const GROK_API_URL = "https://api.x.ai/v1/chat/completions";
const GROK_MODEL = "grok-4-1-fast-reasoning";

const sql = neon(process.env.DATABASE_URL!);

interface BatchNoteInput {
  id: string;
  title: string;
  content: string;
  userId: string;
}

export interface EnrichmentResult {
  summary: {
    context: string;
    keyPoints: string[];
    peopleAndRoles: Record<string, string>;
    decisionsMade: string[];
    nextSteps: string[];
  };
  entities: {
    people: string[];
    companies: string[];
    properties: Array<{ address?: string; type?: string }>;
    projects: string[];
  };
  tags: string[];
  ambiguities: Array<{
    type: string;
    text: string;
    question: string;
  }>;
  category?: string;
  noteType?: string;
  suggestedTitle?: string;
}

/**
 * Load entity disambiguation rules from DB
 * These rules tell the enrichment prompt how to resolve ambiguous first names
 */
async function loadDisambiguationRules(userId: string): Promise<Array<{entity_pattern: string; context_clue: string | null; resolved_name: string}>> {
  try {
    const rows = await sql`
      SELECT entity_pattern, context_clue, resolved_name
      FROM entity_resolution_rules
      WHERE user_id = ${userId}
      ORDER BY entity_pattern, context_clue
    `;
    return rows as Array<{entity_pattern: string; context_clue: string | null; resolved_name: string}>;
  } catch {
    // Table may not exist yet — fall back to empty
    return [];
  }
}

/**
 * Build rich context from user's knowledge base
 */
async function buildKnowledgeContext(userId: string) {
  const [projects, people, companies] = await Promise.all([
    sql`SELECT id, name, status FROM projects WHERE user_id = ${userId} ORDER BY updated_at DESC LIMIT 15`,
    sql`SELECT p.id, p.name, COUNT(np.note_id) as mention_count 
        FROM people p 
        JOIN note_people np ON np.person_id = p.id 
        WHERE p.user_id = ${userId} 
        GROUP BY p.id, p.name 
        ORDER BY mention_count DESC 
        LIMIT 20`,
    sql`SELECT DISTINCT name FROM companies WHERE user_id = ${userId} ORDER BY name LIMIT 20`
  ]);

  return {
    projects: projects as Array<{ id: string; name: string; status: string }>,
    people: people as Array<{ id: string; name: string; mention_count: string }>,
    companies: (companies as Array<{ name: string }>).map(c => c.name)
  };
}

/**
 * Build the enrichment prompt
 */
function buildPrompt(notes: BatchNoteInput[], context: Awaited<ReturnType<typeof buildKnowledgeContext>>, disambiguationRules?: Array<{entity_pattern: string; context_clue: string | null; resolved_name: string}>): string {
  const contextSection = `
## Your Knowledge Base Context

**Active Projects:**
${context.projects.map(p => `- ${p.name}${p.status ? ` (${p.status})` : ''}`).join('\n')}

**Known People:**
${context.people.map(p => `- ${p.name}`).join('\n')}

**Known Companies:**
${context.companies.join(', ')}

## Entity Disambiguation Rules
When you encounter these names, resolve them automatically — do NOT flag as ambiguous:
${disambiguationRules && disambiguationRules.length > 0
  ? disambiguationRules.map(r => `- "${r.entity_pattern}"${r.context_clue ? ` in context of ${r.context_clue}` : ''} → ${r.resolved_name}`).join('\n')
  : `- "Isaac" in real estate/TechRidge/Blackridge context → Isaac Barlow (Barlow Properties)
- "Ryan" in consulting/density context → Ryan Kimball (Kimball Consulting Group)
- "Rob" in consultant context → Rob McFarlane
- Context clue "Techridge" or "Blackridge" → real estate development
- Context clue "St. George" → Southern Utah projects`}
`;

  const notesSection = notes.map((n, i) => `
=== NOTE ${i + 1} (ID: ${n.id}) ===
Title: ${n.title || "(No title)"}
Content: ${n.content.slice(0, 4000)}${n.content.length > 4000 ? '...' : ''}
`).join('\n');

  return `You are analyzing notes for a real estate development business. Use the context to understand references and resolve ambiguities.

${contextSection}

${notesSection}

For each note, return ONLY this JSON structure:

{
  "${notes[0]?.id}": {
    "summary": {
      "context": "What is this note about? 1-2 sentences.",
      "keyPoints": ["Important facts"],
      "peopleAndRoles": {"Person Name": "their role/action"},
      "decisionsMade": ["What was decided"],
      "nextSteps": ["What needs to happen next"]
    },
    "entities": {
      "people": ["Names found"],
      "companies": ["Companies/organizations"],
      "properties": [{"address": "...", "type": "..."}],
      "projects": ["Project names"]
    },
    "tags": ["relevant-keywords"],
    "category": "Work|Personal|Ideas|Reference|Archive|Solar|Real-Estate|Finance|Family",
    "noteType": "meeting-note|conversation|receipt|credential|task|document|contact|research|journal|decision|reference|update",
    "suggestedTitle": "A descriptive title if the current title is empty, 'Untitled', or too short — otherwise null",
    "ambiguities": [
      {
        "type": "entity_resolution|relationship|project_identification",
        "text": "The ambiguous text",
        "question": "What to ask for clarification"
      }
    ]
  }
}

Rules:
1. Use context to resolve ambiguities when possible
2. If uncertain (new person, unclear project), include in ambiguities
3. nextSteps should be specific and actionable
4. category MUST be one of: Work, Personal, Ideas, Reference, Archive, Solar, Real-Estate, Finance, Family
5. noteType MUST be one of: meeting-note, conversation, receipt, credential, task, document, contact, research, journal, decision, reference, update
6. suggestedTitle: provide a descriptive 5-10 word title if the note title is empty, "Untitled", or under 3 characters. Otherwise set to null
7. Return ONLY valid JSON

JSON only:`;
}

/**
 * Extract enrichments with full context
 */
export async function batchExtractEnrichments(
  notes: BatchNoteInput[]
): Promise<Map<string, EnrichmentResult>> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey || notes.length === 0) return new Map();

  const userId = notes[0].userId;
  const [context, disambiguationRules] = await Promise.all([
    buildKnowledgeContext(userId),
    loadDisambiguationRules(userId),
  ]);
  const prompt = buildPrompt(notes, context, disambiguationRules);

  try {
    const response = await fetch(GROK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GROK_MODEL,
        max_tokens: 16000,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      console.error("[ENRICHMENT] Grok API error:", await response.text());
      return new Map();
    }

    const data = await response.json();
    const responseText = data.choices[0]?.message?.content || "";

    // Track tokens
    await trackTokenUsage({
      model: GROK_MODEL,
      operation: "batch-enrich",
      inputTokens: data.usage?.prompt_tokens || estimateTokens(prompt),
      outputTokens: data.usage?.completion_tokens || estimateTokens(responseText),
      metadata: { batchSize: notes.length },
    });

    // Parse response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("[ENRICHMENT] No JSON found");
      return new Map();
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const results = new Map<string, EnrichmentResult>();

    for (const note of notes) {
      const result = parsed[note.id];
      if (!result) continue;

      // Validate category against allowed list
      const validCategories = ['Work', 'Personal', 'Ideas', 'Reference', 'Archive', 'Solar', 'Real-Estate', 'Finance', 'Family'];
      const rawCategory = result.category;
      const category = validCategories.includes(rawCategory) ? rawCategory : undefined;

      // Validate noteType against allowed list
      const validNoteTypes = ['meeting-note', 'conversation', 'receipt', 'credential', 'task', 'document', 'contact', 'research', 'journal', 'decision', 'reference', 'update'];
      const rawNoteType = result.noteType;
      const noteType = validNoteTypes.includes(rawNoteType) ? rawNoteType : undefined;

      results.set(note.id, {
        summary: {
          context: result.summary?.context || '',
          keyPoints: result.summary?.keyPoints || [],
          peopleAndRoles: result.summary?.peopleAndRoles || {},
          decisionsMade: result.summary?.decisionsMade || [],
          nextSteps: result.summary?.nextSteps || [],
        },
        entities: {
          people: result.entities?.people || [],
          companies: result.entities?.companies || [],
          properties: result.entities?.properties || [],
          projects: result.entities?.projects || [],
        },
        tags: (result.tags || []).map((t: string) => t.toLowerCase().replace(/\s+/g, '-')),
        ambiguities: (result.ambiguities || []).filter(
          (a: { question?: string }) => Boolean(a.question)
        ),
        category,
        noteType,
        suggestedTitle: typeof result.suggestedTitle === 'string' && result.suggestedTitle.trim().length > 0
          ? result.suggestedTitle.trim()
          : undefined,
      });
    }

    console.log(`[ENRICHMENT] Processed ${results.size}/${notes.length} notes`);
    return results;
  } catch (error) {
    console.error("[ENRICHMENT] Failed:", error);
    return new Map();
  }
}

/**
 * Find or create a person and link to note
 */
export async function findOrCreatePerson(userId: string, name: string): Promise<{ id: string; name: string }> {
  // Try to find existing person
  const existing = await sql`
    SELECT id, name FROM people 
    WHERE user_id = ${userId} AND name ILIKE ${name}
    LIMIT 1
  `;
  
  if (existing.length > 0) {
    return existing[0] as { id: string; name: string };
  }
  
  // Create new person
  const normalizedName = name.toLowerCase().trim();
  const result = await sql`
    INSERT INTO people (user_id, name, normalized_name, type)
    VALUES (${userId}, ${name}, ${normalizedName}, 'contact')
    ON CONFLICT (user_id, normalized_name) DO UPDATE SET name = EXCLUDED.name
    RETURNING id, name
  `;
  
  return result[0] as { id: string; name: string };
}

/**
 * Link person to note with role
 */
export async function linkPersonToNote(noteId: string, personId: string, role?: string): Promise<void> {
  await sql`
    INSERT INTO note_people (note_id, person_id, role)
    VALUES (${noteId}, ${personId}, ${role || null})
    ON CONFLICT (note_id, person_id) DO UPDATE SET role = EXCLUDED.role
  `;
}

/**
 * Create action item from nextStep
 */
export async function createActionItem(
  noteId: string, 
  userId: string, 
  text: string, 
  source: string = 'ai_extracted'
): Promise<void> {
  // Determine priority from text
  let priority = 'medium';
  if (text.match(/\b(urgent|asap|critical|immediately)\b/i)) priority = 'critical';
  else if (text.match(/\b(high priority|important|soon)\b/i)) priority = 'high';
  else if (text.match(/\b(when possible|low priority|eventually)\b/i)) priority = 'low';
  
  await sql`
    INSERT INTO action_items (note_id, user_id, text, priority, source, status, created_at)
    VALUES (${noteId}::uuid, ${userId}::uuid, ${text}, ${priority}, ${source}, 'pending', NOW())
    ON CONFLICT DO NOTHING
  `;
}

/**
 * Send clarification request via Telegram
 */
export async function sendTelegramClarification(
  noteTitle: string,
  ambiguities: Array<{ type: string; text: string; question: string }>,
  userId: string,
  noteId?: string
): Promise<number> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://notes.sunhomes.io';

  if (!botToken || !chatId || ambiguities.length === 0) return 0;

  let sent = 0;
  const noteLink = noteId ? `${appUrl}/notes/${noteId}` : '';

  for (const ambiguity of ambiguities.slice(0, 2)) { // Max 2 clarifications per note
    const message = `❓ *Clarification Needed*

*Note:* [${noteTitle.slice(0, 80)}${noteTitle.length > 80 ? '...' : ''}](${noteLink})

*Issue:* ${ambiguity.text}

*Question:* ${ambiguity.question}

_Reply to this message with the answer._`;

    try {
      const tgResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: 'Markdown',
          disable_web_page_preview: true
        })
      });

      if (!tgResponse.ok) {
        throw new Error(`Telegram sendMessage failed: ${tgResponse.status}`);
      }

      const tgData = await tgResponse.json() as { result?: { message_id?: number } };
      const telegramMessageId = tgData?.result?.message_id;

      if (telegramMessageId && noteId) {
        await sql`
          UPDATE clarifications
          SET telegram_message_id = ${telegramMessageId}
          WHERE id = (
            SELECT id FROM clarifications
            WHERE note_id = ${noteId}
              AND user_id = ${userId}
              AND status = 'pending'
              AND telegram_message_id IS NULL
            ORDER BY created_at DESC
            LIMIT 1
          )
        `;
      }

      sent++;
      console.log(`[CLARIFICATION] Sent for note: ${noteTitle.slice(0, 40)}`);
    } catch (err) {
      console.error('[CLARIFICATION] Failed to send:', err);
    }
  }
  return sent;
}

/**
 * Generate embeddings for notes
 */
export async function batchGenerateEmbeddings(notes: BatchNoteInput[]): Promise<Map<string, number[]>> {
  const results = new Map<string, number[]>();
  
  for (const note of notes) {
    const text = `${note.title}\n\n${note.content}`;
    const embedding = await generateEmbedding(text);
    if (embedding) {
      results.set(note.id, embedding);
    }
  }
  
  return results;
}
