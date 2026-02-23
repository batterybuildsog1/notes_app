/**
 * Note Enrichment - OpenAI Embeddings + Grok Tag Suggestions
 *
 * Called on note create/update to:
 * 1. Generate embeddings via OpenAI text-embedding-3-small
 * 2. Get tag suggestions via Grok API
 */

import { trackTokenUsage, estimateTokens } from "./token-tracking";
import { neon } from "@neondatabase/serverless";

const OPENAI_API_URL = "https://api.openai.com/v1/embeddings";
const GROK_API_URL = "https://api.x.ai/v1/chat/completions";

// Model constants for token tracking
const GROK_MODEL = "grok-4-1-fast-reasoning";
const EMBEDDING_MODEL = "text-embedding-3-small";

/**
 * Generate embedding for note content using OpenAI
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[ENRICHMENT] OPENAI_API_KEY not set, skipping embedding");
    return null;
  }

  try {
    // Truncate to ~8000 chars to stay within token limits
    const truncatedText = text.slice(0, 8000);

    const response = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: truncatedText,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("[ENRICHMENT] OpenAI embedding error:", error);
      return null;
    }

    const data = await response.json();

    // Track token usage for embeddings
    const inputTokens = data.usage?.prompt_tokens || estimateTokens(truncatedText);
    await trackTokenUsage({
      model: EMBEDDING_MODEL,
      operation: "embed",
      inputTokens,
      outputTokens: 0, // Embeddings don't have output tokens
      metadata: { textLength: truncatedText.length },
    });

    return data.data[0].embedding;
  } catch (error) {
    console.error("[ENRICHMENT] Embedding generation failed:", error);
    return null;
  }
}

/**
 * Get tag suggestions from Grok based on note content
 */
export async function suggestTags(
  title: string,
  content: string,
  existingTags: string[] = []
): Promise<string[]> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    console.warn("[ENRICHMENT] XAI_API_KEY not set, skipping tag suggestions");
    return [];
  }

  try {
    const prompt = `Analyze this note and suggest 2-4 relevant tags. Return ONLY a JSON array of lowercase tag strings, nothing else.

Title: ${title}

Content: ${content.slice(0, 2000)}

Existing tags to avoid duplicating: ${existingTags.join(", ") || "none"}

Rules:
- Tags should be 1-2 words, lowercase, no spaces (use hyphens)
- Focus on topics, projects, or themes
- Be specific, not generic (avoid "notes", "work", "stuff")
- Return empty array [] if no good tags come to mind

JSON array only:`;

    const response = await fetch(GROK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-4-1-fast-reasoning",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("[ENRICHMENT] Grok tag suggestion error:", error);
      return [];
    }

    const data = await response.json();
    const responseText = data.choices[0]?.message?.content || "[]";

    // Track token usage for tag suggestions
    const inputTokens = data.usage?.prompt_tokens || estimateTokens(prompt);
    const outputTokens = data.usage?.completion_tokens || estimateTokens(responseText);
    await trackTokenUsage({
      model: GROK_MODEL,
      operation: "suggest-tags",
      inputTokens,
      outputTokens,
      metadata: { existingTagsCount: existingTags.length },
    });

    // Parse JSON array from response (handle multiline with replace)
    const cleanedResponse = responseText.replace(/\n/g, " ");
    const match = cleanedResponse.match(/\[.*\]/);
    if (match) {
      const tags = JSON.parse(match[0]);
      return Array.isArray(tags) ? tags.filter((t: unknown) => typeof t === "string") : [];
    }

    return [];
  } catch (error) {
    console.error("[ENRICHMENT] Tag suggestion failed:", error);
    return [];
  }
}

/**
 * Suggest category based on note content
 */
export async function suggestCategory(
  title: string,
  content: string
): Promise<string | null> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return null;

  try {
    const prompt = `Categorize this note into ONE of these categories: Work, Personal, Ideas, Reference, Archive, Solar, Real-Estate, Finance, Family.

Title: ${title}
Content: ${content.slice(0, 1000)}

Respond with ONLY the category name, nothing else:`;

    const response = await fetch(GROK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-4-1-fast-reasoning",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
      }),
    });

    if (!response.ok) return null;

    const data = await response.json();
    const category = data.choices[0]?.message?.content?.trim();

    // Track token usage for category suggestion
    const inputTokens = data.usage?.prompt_tokens || estimateTokens(prompt);
    const outputTokens = data.usage?.completion_tokens || estimateTokens(category || "");
    await trackTokenUsage({
      model: GROK_MODEL,
      operation: "suggest-category",
      inputTokens,
      outputTokens,
    });

    const validCategories = ["Work", "Personal", "Ideas", "Reference", "Archive", "Solar", "Real-Estate", "Finance", "Family"];
    return validCategories.includes(category) ? category : null;
  } catch {
    return null;
  }
}

/**
 * Assess if a note is clear enough for automatic classification
 * Returns a question to ask if clarification is needed
 */
export async function assessNoteClarity(
  title: string,
  content: string,
  userId?: string
): Promise<{
  needsClarification: boolean;
  question: string | null;
  confidence: number;
}> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    return { needsClarification: false, question: null, confidence: 1 };
  }

  // Load known entities and disambiguation rules to avoid redundant questions
  let entityContext = "";
  if (userId && process.env.DATABASE_URL) {
    try {
      const db = neon(process.env.DATABASE_URL);
      const [people, companies, rules] = await Promise.all([
        db`SELECT DISTINCT name FROM people WHERE user_id = ${userId} ORDER BY name LIMIT 30`,
        db`SELECT DISTINCT name FROM companies WHERE user_id = ${userId} ORDER BY name LIMIT 20`,
        db`SELECT entity_pattern, context_clue, resolved_name FROM entity_resolution_rules WHERE user_id = ${userId}`.catch(() => []),
      ]);

      const knownPeople = people.map(p => (p as {name: string}).name);
      const knownCompanies = companies.map(c => (c as {name: string}).name);
      const disambiguationRules = rules as Array<{entity_pattern: string; context_clue: string | null; resolved_name: string}>;

      entityContext = `
## Known Entities (DO NOT ask about these — they are already identified)
Known People: ${knownPeople.join(', ')}
Known Companies: ${knownCompanies.join(', ')}

## Disambiguation Rules (these names are already resolved)
${disambiguationRules.map(r => `- "${r.entity_pattern}"${r.context_clue ? ` (in ${r.context_clue} context)` : ''} = ${r.resolved_name}`).join('\n')}

IMPORTANT: If a name in the note matches a known person, company, or disambiguation rule above, do NOT flag it as needing clarification. Only ask about truly unknown or ambiguous references.
`;
    } catch {
      // Ignore errors — proceed without context
    }
  }

  try {
    const prompt = `Analyze this note and determine if it's clear enough to classify and enrich automatically.

Title: ${title}
Content: ${content.slice(0, 1500)}
${entityContext}
Consider these vagueness indicators:
1. Is the topic/subject clear?
2. Is there enough context to determine what this relates to?
3. Are there ambiguous acronyms or references without context?
4. **Vague pronouns**: Does it say "he", "she", "they", "him", "her" without naming who?
5. **Vague property references**: Does it say "the property", "the house", "the unit" without an address?
6. **Vague company references**: Does it say "the bank", "the lender", "the contractor" without naming them?
7. **Vague project references**: Does it say "the deal", "the project" without specifying which one?

Respond in this exact JSON format:
{
  "needsClarification": true/false,
  "confidence": 0.0-1.0,
  "question": "A specific question to ask the user for context" or null
}

Rules:
- Set needsClarification=true if the note uses vague pronouns or references that make it hard to link to specific people, companies, or projects
- Do NOT ask about names that match Known Entities or Disambiguation Rules listed above
- The question should ask for the specific missing information (e.g., "Who is 'he' referring to?" or "Which property is this about?")
- Short notes are fine if the entities are clearly named
- Only ask ONE focused question about the most important missing context`;

    const response = await fetch(GROK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-4-1-fast-reasoning",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      return { needsClarification: false, question: null, confidence: 1 };
    }

    const data = await response.json();
    const responseText = data.choices[0]?.message?.content || "";

    // Track token usage for clarity assessment
    const inputTokens = data.usage?.prompt_tokens || estimateTokens(prompt);
    const outputTokens = data.usage?.completion_tokens || estimateTokens(responseText);
    await trackTokenUsage({
      model: GROK_MODEL,
      operation: "assess-clarity",
      inputTokens,
      outputTokens,
    });

    // Extract JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        needsClarification: Boolean(parsed.needsClarification),
        question: parsed.question || null,
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
      };
    }

    return { needsClarification: false, question: null, confidence: 1 };
  } catch (error) {
    console.error("[ENRICHMENT] Clarity assessment failed:", error);
    return { needsClarification: false, question: null, confidence: 1 };
  }
}

/**
 * Classify note with user-provided context
 */
export async function classifyWithContext(
  title: string,
  content: string,
  userContext: string,
  existingTags: string[] = []
): Promise<{
  suggestedTags: string[];
  suggestedCategory: string | null;
}> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    return { suggestedTags: [], suggestedCategory: null };
  }

  try {
    const prompt = `Classify this note based on the content and user-provided context.

Title: ${title}
Content: ${content.slice(0, 1500)}

User's additional context: ${userContext}

Existing tags to avoid duplicating: ${existingTags.join(", ") || "none"}

Respond in this exact JSON format:
{
  "tags": ["tag1", "tag2"],
  "category": "Work|Personal|Ideas|Reference|Archive|Solar|Real-Estate|Finance|Family"
}

Rules:
- Tags should be 1-2 words, lowercase, no spaces (use hyphens)
- 2-4 tags max
- Category must be one of the exact options listed`;

    const response = await fetch(GROK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-4-1-fast-reasoning",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      return { suggestedTags: [], suggestedCategory: null };
    }

    const data = await response.json();
    const responseText = data.choices[0]?.message?.content || "";

    // Track token usage for context classification
    const inputTokens = data.usage?.prompt_tokens || estimateTokens(prompt);
    const outputTokens = data.usage?.completion_tokens || estimateTokens(responseText);
    await trackTokenUsage({
      model: GROK_MODEL,
      operation: "classify-with-context",
      inputTokens,
      outputTokens,
    });

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const validCategories = ["Work", "Personal", "Ideas", "Reference", "Archive", "Solar", "Real-Estate", "Finance", "Family"];
      return {
        suggestedTags: Array.isArray(parsed.tags) ? parsed.tags.filter((t: unknown) => typeof t === "string") : [],
        suggestedCategory: validCategories.includes(parsed.category) ? parsed.category : null,
      };
    }

    return { suggestedTags: [], suggestedCategory: null };
  } catch (error) {
    console.error("[ENRICHMENT] Context classification failed:", error);
    return { suggestedTags: [], suggestedCategory: null };
  }
}

/**
 * Full enrichment pipeline - call on note save
 */
export async function enrichNote(
  title: string,
  content: string,
  existingTags: string[] = [],
  existingCategory: string | null = null
): Promise<{
  embedding: number[] | null;
  suggestedTags: string[];
  suggestedCategory: string | null;
}> {
  const fullText = `${title}\n\n${content}`;

  // Run embedding and tag suggestion in parallel
  const [embedding, suggestedTags, suggestedCategory] = await Promise.all([
    generateEmbedding(fullText),
    suggestTags(title, content, existingTags),
    existingCategory ? Promise.resolve(null) : suggestCategory(title, content),
  ]);

  return {
    embedding,
    suggestedTags,
    suggestedCategory,
  };
}
