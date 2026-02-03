/**
 * Batch Enrichment - Process multiple notes in single API calls
 *
 * Reduces Grok API costs by ~50% through batching entity extraction
 */

import { trackTokenUsage, estimateTokens } from "./token-tracking";
import { generateEmbedding } from "./enrichment";
import { ExtractedEntities } from "./entity-extraction";

const GROK_API_URL = "https://api.x.ai/v1/chat/completions";
const GROK_MODEL = "grok-4-1-fast-reasoning";

export interface BatchNoteInput {
  id: string;
  title: string;
  content: string;
}

export interface BatchExtractionResult {
  noteId: string;
  entities: ExtractedEntities;
  error?: string;
}

/**
 * Extract entities from multiple notes in a single Grok API call
 * Processes up to 15 notes at once to reduce API costs
 */
export async function batchExtractEntities(
  notes: BatchNoteInput[]
): Promise<Map<string, ExtractedEntities>> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    console.warn("[BATCH-ENRICHMENT] XAI_API_KEY not set");
    return new Map();
  }

  if (notes.length === 0) {
    return new Map();
  }

  // Build batch prompt
  const notesSection = notes
    .map(
      (n, i) => `
=== NOTE ${i + 1} (ID: ${n.id}) ===
Title: ${n.title || "(No title)"}
Content: ${n.content.slice(0, 1500)}`
    )
    .join("\n");

  const prompt = `Analyze these ${notes.length} notes from a real estate business and extract entities for EACH note.

${notesSection}

For EACH note, extract and return a JSON object with the note ID as the key.
Return ONLY valid JSON (no markdown, no explanation):

{
  "${notes[0].id}": {
    "people": ["Full Name"],
    "companies": ["Company/Bank/Vendor Name"],
    "properties": [{"address": "Street address, City", "type": "condo|townhouse|single-family|duplex|multi-family|land|commercial"}],
    "project": "Project or deal name if identifiable",
    "suggestedTitle": "A descriptive title if current title is vague or 'Untitled'",
    "tags": ["specific-tag"]
  },
  "${notes.length > 1 ? notes[1].id : "note-2"}": { ... }
}

Rules for EACH note:
- Only include entities ACTUALLY MENTIONED in that specific note
- People: Use full names when available
- Companies: Include banks, vendors, contractors, agencies, LLCs
- Properties: Extract addresses and property types
- Project: Name of a deal, development, or project
- Tags: Specific keywords like "refinance", "inspection", "closing", "permit"
- suggestedTitle: Only provide if title is empty, "Untitled", or vague
- Return empty arrays [] for categories with no matches
- Do NOT make up entities

JSON only:`;

  try {
    const response = await fetch(GROK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GROK_MODEL,
        max_tokens: 4000, // Higher limit for batch
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("[BATCH-ENRICHMENT] Grok API error:", error);
      return new Map();
    }

    const data = await response.json();
    const responseText = data.choices[0]?.message?.content || "";

    // Track token usage for batch extraction
    const inputTokens = data.usage?.prompt_tokens || estimateTokens(prompt);
    const outputTokens =
      data.usage?.completion_tokens || estimateTokens(responseText);
    await trackTokenUsage({
      model: GROK_MODEL,
      operation: "batch-extract-entities",
      inputTokens,
      outputTokens,
      metadata: { batchSize: notes.length },
    });

    // Parse the batch response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn(
        "[BATCH-ENRICHMENT] No JSON in response:",
        responseText.slice(0, 200)
      );
      return new Map();
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const results = new Map<string, ExtractedEntities>();

    // Process each note's result
    for (const note of notes) {
      const noteResult = parsed[note.id];
      if (!noteResult) {
        console.warn(`[BATCH-ENRICHMENT] Missing result for note ${note.id}`);
        // Return empty entities for missing results
        results.set(note.id, {
          people: [],
          companies: [],
          properties: [],
          tags: [],
        });
        continue;
      }

      // Validate and sanitize the response
      results.set(note.id, {
        people: Array.isArray(noteResult.people)
          ? noteResult.people.filter(
              (p: unknown) => typeof p === "string" && p.length > 1
            )
          : [],
        companies: Array.isArray(noteResult.companies)
          ? noteResult.companies.filter(
              (c: unknown) => typeof c === "string" && c.length > 1
            )
          : [],
        properties: Array.isArray(noteResult.properties)
          ? noteResult.properties.filter(
              (p: unknown) => p && typeof p === "object"
            )
          : [],
        project:
          typeof noteResult.project === "string" && noteResult.project.length > 1
            ? noteResult.project
            : undefined,
        suggestedTitle:
          typeof noteResult.suggestedTitle === "string" &&
          noteResult.suggestedTitle.length > 2
            ? noteResult.suggestedTitle
            : undefined,
        tags: Array.isArray(noteResult.tags)
          ? noteResult.tags
              .filter((t: unknown) => typeof t === "string" && t.length > 1)
              .map((t: string) => t.toLowerCase().replace(/\s+/g, "-"))
          : [],
      });
    }

    console.log(
      `[BATCH-ENRICHMENT] Extracted entities for ${results.size}/${notes.length} notes`
    );
    return results;
  } catch (error) {
    console.error("[BATCH-ENRICHMENT] Failed:", error);
    return new Map();
  }
}

/**
 * Generate embeddings for multiple notes in parallel
 * Uses Promise.allSettled to handle individual failures
 */
export async function batchGenerateEmbeddings(
  notes: BatchNoteInput[]
): Promise<Map<string, number[]>> {
  const results = new Map<string, number[]>();

  if (notes.length === 0) {
    return results;
  }

  // Process in parallel with Promise.allSettled
  const embeddingPromises = notes.map(async (note) => {
    const text = `${note.title}\n\n${note.content}`;
    const embedding = await generateEmbedding(text);
    return { noteId: note.id, embedding };
  });

  const settled = await Promise.allSettled(embeddingPromises);

  for (const result of settled) {
    if (result.status === "fulfilled" && result.value.embedding) {
      results.set(result.value.noteId, result.value.embedding);
    }
  }

  console.log(
    `[BATCH-ENRICHMENT] Generated embeddings for ${results.size}/${notes.length} notes`
  );
  return results;
}

/**
 * Convert extracted entities to tags (helper for batch processing)
 */
export function entitiesToTags(entities: ExtractedEntities): string[] {
  const tags = new Set<string>();

  // Add people as tags
  entities.people.forEach((name) => {
    tags.add(name.toLowerCase().replace(/\s+/g, "-"));
  });

  // Add companies as tags
  entities.companies.forEach((company) => {
    tags.add(company.toLowerCase().replace(/\s+/g, "-"));
  });

  // Add property types as tags
  entities.properties.forEach((prop) => {
    if (prop.type) {
      tags.add(prop.type);
    }
  });

  // Add project as tag
  if (entities.project) {
    tags.add(entities.project.toLowerCase().replace(/\s+/g, "-"));
  }

  // Add explicit tags
  entities.tags.forEach((tag) => {
    tags.add(tag);
  });

  return Array.from(tags);
}
