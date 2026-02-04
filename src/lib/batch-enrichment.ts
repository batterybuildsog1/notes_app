/**
 * Enhanced Batch Enrichment - Relationships & Clarifications
 *
 * Core principle: When unsure, ask for clarification via Telegram
 * No confidence scores - either certain or ask
 */

import { trackTokenUsage, estimateTokens } from "./token-tracking";
import { generateEmbedding } from "./enrichment";
import { neon } from "@neondatabase/serverless";
import { createClarification, findOrCreatePerson } from "./db";
import { sendTelegramMessage, isTelegramConfigured } from "./telegram";

const GROK_API_URL = "https://api.x.ai/v1/chat/completions";
const GROK_MODEL = "grok-4-1-fast-reasoning";

interface BatchNoteInput {
  id: string;
  title: string;
  content: string;
  userId: string;
}

interface Relationship {
  source: string;
  sourceType: 'person' | 'company' | 'project' | 'property';
  target: string;
  targetType: 'person' | 'company' | 'project' | 'property';
  relationship: string;
  context: string;
  certain: boolean;
}

interface ActionItem {
  text: string;
  assignee: string | null;
  dueDate: string | null;
  dueDateDescription: string | null;
  priority: 'critical' | 'high' | 'medium' | 'low';
  source: 'meeting_outcome' | 'explicit_request' | 'implied' | 'follow_up';
  certain: boolean;
}

interface Ambiguity {
  type: 'entity_resolution' | 'relationship' | 'project_identification' | 'temporal';
  text: string;
  options?: string[];
  question: string;
}

interface EnrichmentResult {
  summary: {
    context: string;
    keyPoints: string[];
    peopleAndRoles: Record<string, string>;
    decisionsMade: string[];
    nextSteps: string[];
  };
  actionItems: ActionItem[];
  relationships: Relationship[];
  entities: {
    people: string[];
    companies: string[];
    properties: Array<{ address?: string; type?: string }>;
    projects: string[];
  };
  tags: string[];
  intent: {
    type: string;
    extracted: Record<string, unknown>;
  };
  temporalReferences: Array<{
    text: string;
    type: 'explicit_date' | 'relative' | 'deadline' | 'milestone';
    normalizedDate: string | null;
    description: string;
    isDeadline: boolean;
  }>;
  ambiguities: Ambiguity[];
  suggestedConnections: Array<{
    noteId: string;
    reason: string;
  }>;
}

const sql = neon(process.env.DATABASE_URL!);

/**
 * Build rich context from user's knowledge base
 * This improves over time as more notes are processed
 */
async function buildKnowledgeContext(userId: string): Promise<{
  projects: Array<{ id: string; name: string; status: string }>;
  people: Array<{ id: string; name: string; mentionCount: number }>;
  recentSummaries: Array<{ id: string; title: string; summary: string }>;
  companies: string[];
}> {
  const [projects, people, recentSummaries, companies] = await Promise.all([
    sql`
      SELECT id, name, status
      FROM projects
      WHERE user_id = ${userId}
      ORDER BY updated_at DESC
      LIMIT 15
    `,
    sql`
      SELECT p.id, p.name, COUNT(np.note_id) as mention_count
      FROM people p
      JOIN note_people np ON np.person_id = p.id
      WHERE p.user_id = ${userId}
      GROUP BY p.id, p.name
      ORDER BY mention_count DESC
      LIMIT 20
    `,
    sql`
      SELECT id, title, ai_summary
      FROM notes
      WHERE user_id = ${userId}
        AND ai_summary IS NOT NULL
      ORDER BY summary_generated_at DESC
      LIMIT 10
    `,
    sql`
      SELECT DISTINCT name
      FROM companies
      WHERE user_id = ${userId}
      ORDER BY name
      LIMIT 20
    `
  ]);

  return {
    projects: projects as Array<{ id: string; name: string; status: string }>,
    people: (people as Array<{ id: string; name: string; mention_count: string }>).map(p => ({
      ...p,
      mentionCount: parseInt(p.mention_count)
    })),
    recentSummaries: recentSummaries as Array<{ id: string; title: string; summary: string }>,
    companies: (companies as Array<{ name: string }>).map(c => c.name)
  };
}

/**
 * Build the enrichment prompt with full context
 */
function buildPrompt(notes: BatchNoteInput[], context: Awaited<ReturnType<typeof buildKnowledgeContext>>): string {
  const contextSection = `
## Your Knowledge Base Context

**Active Projects:**
${context.projects.map(p => `- ${p.name}${p.status ? ` (${p.status})` : ''}`).join('\n')}

**Known People:**
${context.people.map(p => `- ${p.name}`).join('\n')}

**Known Companies:**
${context.companies.join(', ')}

**Recent Topics:**
${context.recentSummaries.map(s => `- ${s.title}: ${s.summary?.substring(0, 100)}...`).join('\n')}
`;

  const notesSection = notes.map((n, i) => `
=== NOTE ${i + 1} (ID: ${n.id}) ===
Title: ${n.title || "(No title)"}
Content: ${(n.content || '').slice(0, 3000)}${(n.content || '').length > 3000 ? '...' : ''}
`).join('\n');

  return `You are analyzing notes for a real estate development business. You have access to the user's knowledge base context below. Use it to understand references, identify relationships, and extract insights.

${contextSection}

${notesSection}

For each note, return a JSON object with this structure:

{
  "${notes[0]?.id}": {
    "summary": {
      "context": "What is this note about? 1-2 sentences.",
      "keyPoints": ["Important facts, 2-4 items"],
      "peopleAndRoles": {"Person Name": "their role/action"},
      "decisionsMade": ["What was decided/agreed"],
      "nextSteps": ["What needs to happen next"]
    },

    "actionItems": [
      {
        "text": "Specific action",
        "assignee": "Person name or 'user' or null",
        "dueDate": "ISO date if explicit",
        "dueDateDescription": "e.g., 'next Tuesday'",
        "priority": "critical|high|medium|low",
        "source": "meeting_outcome|explicit_request|implied|follow_up",
        "certain": true/false
      }
    ],

    "relationships": [
      {
        "source": "Entity name",
        "sourceType": "person|company|project|property",
        "target": "Related entity",
        "targetType": "person|company|project|property",
        "relationship": "works_for|consultant_for|decision_maker|depends_on|connected_to|building|advisor_to|investor_in",
        "context": "Evidence from note",
        "certain": true/false
      }
    ],

    "entities": {
      "people": ["Names found"],
      "companies": ["Companies/organizations"],
      "properties": [{"address": "...", "type": "..."}],
      "projects": ["Project names mentioned"]
    },

    "tags": ["relevant-keywords"],

    "intent": {
      "type": "meeting_outcomes|idea_capture|research|todo_list|question|decision|reference|call_notes|status_update",
      "extracted": {}
    },

    "temporalReferences": [
      {
        "text": "Original",
        "type": "explicit_date|relative|deadline|milestone",
        "normalizedDate": "ISO or null",
        "description": "Human readable",
        "isDeadline": true/false
      }
    ],

    "ambiguities": [
      {
        "type": "entity_resolution|relationship|project_identification|temporal",
        "text": "The ambiguous text",
        "question": "What to ask user for clarification"
      }
    ],

    "suggestedConnections": [
      {
        "noteId": "UUID from context if related",
        "reason": "Why connected"
      }
    ]
  }
}

Rules:
1. Use the context to resolve ambiguities when possible
2. If a person/company is mentioned but unclear which one, mark as ambiguous
3. Only mark relationships as certain if explicitly stated or clearly implied
4. Action items should be concrete and actionable
5. suggestedConnections should reference note IDs from Recent Topics if relevant
6. Return ONLY valid JSON

JSON only:`;
}

/**
 * Extract enrichments with full context and ambiguity detection
 */
export async function batchExtractEnrichments(
  notes: BatchNoteInput[]
): Promise<Map<string, EnrichmentResult>> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    console.warn("[ENRICHMENT] XAI_API_KEY not set");
    return new Map();
  }

  if (notes.length === 0) return new Map();

  // All notes should be same user in a batch
  const userId = notes[0].userId;

  // Build rich context
  const context = await buildKnowledgeContext(userId);
  const prompt = buildPrompt(notes, context);

  try {
    const response = await fetch(GROK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GROK_MODEL,
        max_tokens: 8000,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("[ENRICHMENT] Grok API error:", error);
      return new Map();
    }

    const data = await response.json();
    const responseText = data.choices[0]?.message?.content || "";

    // Track tokens
    const inputTokens = data.usage?.prompt_tokens || estimateTokens(prompt);
    const outputTokens = data.usage?.completion_tokens || estimateTokens(responseText);
    await trackTokenUsage({
      model: GROK_MODEL,
      operation: "enrich-with-context",
      inputTokens,
      outputTokens,
      metadata: { batchSize: notes.length, contextItems: context.projects.length + context.people.length },
    });

    // Parse response - with proper error handling
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("[ENRICHMENT] No JSON found:", responseText.slice(0, 200));
      return new Map();
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error("[ENRICHMENT] JSON parse failed:", parseError);
      console.warn("[ENRICHMENT] Raw response:", responseText.slice(0, 500));
      return new Map();
    }

    const results = new Map<string, EnrichmentResult>();

    for (const note of notes) {
      const result = parsed[note.id];
      if (!result) {
        console.warn(`[ENRICHMENT] Missing result for note ${note.id}`);
        continue;
      }

      results.set(note.id, {
        summary: {
          context: result.summary?.context || '',
          keyPoints: result.summary?.keyPoints || [],
          peopleAndRoles: result.summary?.peopleAndRoles || {},
          decisionsMade: result.summary?.decisionsMade || [],
          nextSteps: result.summary?.nextSteps || [],
        },
        actionItems: (result.actionItems || []).filter((a: ActionItem) => a.text?.length > 5),
        relationships: (result.relationships || []).filter((r: Relationship) => r.source && r.target),
        entities: {
          people: result.entities?.people || [],
          companies: result.entities?.companies || [],
          properties: result.entities?.properties || [],
          projects: result.entities?.projects || [],
        },
        tags: (result.tags || []).map((t: string) => t.toLowerCase().replace(/\s+/g, '-')),
        intent: {
          type: result.intent?.type || 'reference',
          extracted: result.intent?.extracted || {},
        },
        temporalReferences: (result.temporalReferences || []).map((t: any) => ({
          text: t.text,
          type: t.type,
          normalizedDate: t.normalizedDate,
          description: t.description,
          isDeadline: t.isDeadline || false,
        })),
        ambiguities: (result.ambiguities || []).filter((a: Ambiguity) => a.question),
        suggestedConnections: (result.suggestedConnections || []).filter((c: any) => c.noteId && c.reason),
      });
    }

    console.log(`[ENRICHMENT] Processed ${results.size}/${notes.length} notes with context`);
    return results;
  } catch (error) {
    console.error("[ENRICHMENT] Failed:", error);
    return new Map();
  }
}

/**
 * Handle ambiguities by sending Telegram clarifications
 */
export async function handleAmbiguities(
  noteId: string,
  noteTitle: string,
  ambiguities: Ambiguity[],
  userId: string
): Promise<void> {
  if (!isTelegramConfigured() || ambiguities.length === 0) return;

  for (const ambiguity of ambiguities) {
    try {
      let message = `❓ *Clarification Needed*\n\n`;
      message += `Note: "${noteTitle}"\n\n`;
      message += `Issue: ${ambiguity.text}\n\n`;
      message += `Question: ${ambiguity.question}`;

      if (ambiguity.options && ambiguity.options.length > 0) {
        message += `\n\nOptions:\n${ambiguity.options.map((o, i) => `${i + 1}. ${o}`).join('\n')}`;
      }

      const result = await sendTelegramMessage(message, { parseMode: "Markdown" });

      if (result.messageId) {
        await createClarification(noteId, userId, ambiguity.question);
        console.log(`[ENRICHMENT] Sent clarification request for note ${noteId}`);
      }
    } catch (err) {
      console.warn(`[ENRICHMENT] Failed to send clarification:`, err);
    }
  }
}

/**
 * Generate embeddings for notes
 */
export async function batchGenerateEmbeddings(
  notes: BatchNoteInput[]
): Promise<Map<string, number[]>> {
  const results = new Map<string, number[]>();

  const promises = notes.map(async (note) => {
    const text = `${note.title}\n\n${note.content}`;
    const embedding = await generateEmbedding(text);
    return { noteId: note.id, embedding };
  });

  const settled = await Promise.allSettled(promises);

  for (const result of settled) {
    if (result.status === "fulfilled" && result.value.embedding) {
      results.set(result.value.noteId, result.value.embedding);
    }
  }

  return results;
}

/**
 * Convert entities to tags
 */
export function entitiesToTags(entities: EnrichmentResult['entities']): string[] {
  const tags = new Set<string>();

  entities.people?.forEach(p => tags.add(p.toLowerCase().replace(/\s+/g, '-')));
  entities.companies?.forEach(c => tags.add(c.toLowerCase().replace(/\s+/g, '-')));
  entities.projects?.forEach(p => tags.add(p.toLowerCase().replace(/\s+/g, '-')));

  return Array.from(tags);
}
