/**
 * Smart Entity Extraction for Real Estate Notes
 * Uses Grok to extract specific, searchable entities
 */

import {
  findOrCreatePerson,
  findOrCreateCompany,
  findOrCreateProject,
  linkPersonToNote,
  linkCompanyToNote,
  linkProjectToNote,
  LinkedEntity,
  getUserProjects,
  getProjectsWithSharedEntities,
  findSimilarProjects,
  getNoteProjectLinks,
  getNoteEmbedding,
  normalizeName,
  Project,
} from "./db";
import { trackTokenUsage, estimateTokens } from "./token-tracking";

const GROK_API_URL = "https://api.x.ai/v1/chat/completions";
const GROK_MODEL = "grok-4-1-fast-reasoning";

export interface ExtractedEntities {
  people: string[];
  companies: string[];
  properties: {
    address?: string;
    type?: "condo" | "townhouse" | "single-family" | "duplex" | "multi-family" | "land" | "commercial";
  }[];
  project?: string;
  suggestedTitle?: string;
  tags: string[];
}

/**
 * Extract entities from note content using Grok
 */
export async function extractEntities(
  title: string,
  content: string
): Promise<ExtractedEntities> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    console.warn("[ENTITY-EXTRACTION] XAI_API_KEY not set");
    return { people: [], companies: [], properties: [], tags: [] };
  }

  const isUntitled = !title ||
    title.toLowerCase() === "untitled" ||
    title.trim().length < 3 ||
    /^note\s*\d*$/i.test(title.trim());

  const prompt = `You are analyzing a note from a real estate/solar business. Extract entities AND generate meaningful semantic tags.

Title: ${title || "(No title)"}
Content: ${content.slice(0, 3000)}

Return ONLY valid JSON (no markdown, no explanation):
{
  "people": ["Full Name"],
  "companies": ["Company Name"],
  "properties": [{"address": "123 Main St, City", "type": "single-family"}],
  "project": "Project name if identifiable",
  "suggestedTitle": ${isUntitled ? '"Descriptive title based on content"' : "null"},
  "tags": ["semantic-topic-tag"]
}

## ENTITY RULES:
- Extract ONLY entities explicitly mentioned
- People: Full names preferred (e.g., "John Smith" not just "John")
- Companies: Banks, contractors, vendors, LLCs, agencies
- Properties: Street address + type (condo|townhouse|single-family|duplex|multi-family|land|commercial)
- Project: Named deals, developments, or ongoing projects

## TAG RULES - CRITICAL:
Tags describe WHAT the note is about, NOT entity names.

GOOD TAGS (use these patterns):
- "inverter-troubleshooting" - activity type
- "permit-application" - specific action
- "payment-dispute" - situation
- "site-survey" - work type
- "callback-needed" - actionable status
- "equipment-order" - topic
- "loan-refinance" - subject matter

BAD TAGS (avoid):
- "solar", "install", "work", "payment" - too generic
- Person or company names - redundant with entities
- Single generic words

Generate 2-5 SPECIFIC tags that help categorize and find this note.

JSON only:`;

  try {
    const response = await fetch(GROK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-4-1-fast-reasoning",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("[ENTITY-EXTRACTION] Grok API error:", error);
      return { people: [], companies: [], properties: [], tags: [] };
    }

    const data = await response.json();
    const responseText = data.choices[0]?.message?.content || "";

    // Track token usage for entity extraction
    const inputTokens = data.usage?.prompt_tokens || estimateTokens(prompt);
    const outputTokens = data.usage?.completion_tokens || estimateTokens(responseText);
    await trackTokenUsage({
      model: GROK_MODEL,
      operation: "extract-entities",
      inputTokens,
      outputTokens,
      metadata: { titleLength: title.length, contentLength: content.length },
    });

    // Extract JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("[ENTITY-EXTRACTION] No JSON in response:", responseText.slice(0, 200));
      return { people: [], companies: [], properties: [], tags: [] };
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate and sanitize the response
    return {
      people: Array.isArray(parsed.people)
        ? parsed.people.filter((p: unknown) => typeof p === "string" && p.length > 1)
        : [],
      companies: Array.isArray(parsed.companies)
        ? parsed.companies.filter((c: unknown) => typeof c === "string" && c.length > 1)
        : [],
      properties: Array.isArray(parsed.properties)
        ? parsed.properties.filter((p: unknown) => p && typeof p === "object")
        : [],
      project: typeof parsed.project === "string" && parsed.project.length > 1
        ? parsed.project
        : undefined,
      suggestedTitle: typeof parsed.suggestedTitle === "string" && parsed.suggestedTitle.length > 2
        ? parsed.suggestedTitle
        : undefined,
      tags: Array.isArray(parsed.tags)
        ? parsed.tags
            .filter((t: unknown) => typeof t === "string" && t.length > 1)
            .map((t: string) => t.toLowerCase().replace(/\s+/g, "-"))
        : [],
    };
  } catch (error) {
    console.error("[ENTITY-EXTRACTION] Failed:", error);
    return { people: [], companies: [], properties: [], tags: [] };
  }
}

/**
 * Convert extracted entities to searchable tags
 */
export function entitiesToTags(entities: ExtractedEntities): string[] {
  const tags = new Set<string>();

  // Add people as tags (lowercase, hyphenated)
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

  // Add project as tag if exists
  if (entities.project) {
    tags.add(entities.project.toLowerCase().replace(/\s+/g, "-"));
  }

  // Add explicit tags
  entities.tags.forEach((tag) => {
    tags.add(tag);
  });

  return Array.from(tags);
}

/**
 * Full entity enrichment - extract and format for database
 */
export async function enrichWithEntities(
  title: string,
  content: string,
  existingTags: string[] = []
): Promise<{
  tags: string[];
  project: string | null;
  newTitle: string | null;
  entities: ExtractedEntities;
}> {
  const entities = await extractEntities(title, content);
  const entityTags = entitiesToTags(entities);

  // Merge with existing tags, avoiding duplicates
  const allTags = new Set([...existingTags, ...entityTags]);

  return {
    tags: Array.from(allTags),
    project: entities.project || null,
    newTitle: entities.suggestedTitle || null,
    entities, // Return raw entities for CRM linking
  };
}

/**
 * Link extracted entities to a note in the database
 * Creates entities if they don't exist, links them via junction tables
 */
export interface LinkedEntities {
  people: LinkedEntity[];
  companies: LinkedEntity[];
  projects: LinkedEntity[];
}

export async function linkEntitiesToNote(
  noteId: string,
  userId: string,
  entities: ExtractedEntities
): Promise<LinkedEntities> {
  const result: LinkedEntities = {
    people: [],
    companies: [],
    projects: [],
  };

  // Link people
  for (const name of entities.people) {
    try {
      const person = await findOrCreatePerson(userId, name);
      await linkPersonToNote(noteId, person.id);
      result.people.push({
        id: person.id,
        name: person.name,
        isNew: person.isNew,
      });
    } catch (err) {
      console.warn(`[ENTITY-LINK] Failed to link person "${name}":`, err);
    }
  }

  // Link companies
  for (const name of entities.companies) {
    try {
      const company = await findOrCreateCompany(userId, name);
      await linkCompanyToNote(noteId, company.id);
      result.companies.push({
        id: company.id,
        name: company.name,
        isNew: company.isNew,
      });
    } catch (err) {
      console.warn(`[ENTITY-LINK] Failed to link company "${name}":`, err);
    }
  }

  // Link project (singular from entities, but could have multiple)
  if (entities.project) {
    try {
      const project = await findOrCreateProject(userId, entities.project);
      await linkProjectToNote(noteId, project.id);
      result.projects.push({
        id: project.id,
        name: project.name,
        isNew: project.isNew,
      });
    } catch (err) {
      console.warn(`[ENTITY-LINK] Failed to link project "${entities.project}":`, err);
    }
  }

  console.log(
    `[ENTITY-LINK] Linked to note ${noteId}: ${result.people.length} people, ${result.companies.length} companies, ${result.projects.length} projects`
  );

  return result;
}

/**
 * Extract entities with additional context from user clarification
 */
export async function extractEntitiesWithContext(
  title: string,
  content: string,
  userContext: string
): Promise<ExtractedEntities> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    console.warn("[ENTITY-EXTRACTION] XAI_API_KEY not set");
    return { people: [], companies: [], properties: [], tags: [] };
  }

  const prompt = `Analyze this note with the additional context provided by the user.

Title: ${title || "(No title)"}
Content: ${content.slice(0, 3000)}

User's clarification: ${userContext}

Extract and return ONLY valid JSON (no markdown, no explanation):
{
  "people": ["Full Name"],
  "companies": ["Company/Bank/Vendor Name"],
  "properties": [
    {"address": "Street address, City", "type": "condo|townhouse|single-family|duplex|multi-family|land|commercial"}
  ],
  "project": "Project or deal name if identifiable",
  "tags": ["specific-tag"]
}

Rules:
- Use the user's clarification to fill in missing context
- People: Use full names from clarification
- Companies: Include banks, vendors, contractors from note + clarification
- Properties: Extract addresses and property types
- Project: Name of a deal, development, or project
- Tags: Specific keywords, not generic
- Return empty arrays [] for categories with no matches

JSON only:`;

  try {
    const response = await fetch(GROK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-4-1-fast-reasoning",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("[ENTITY-EXTRACTION] Grok API error:", error);
      return { people: [], companies: [], properties: [], tags: [] };
    }

    const data = await response.json();
    const responseText = data.choices[0]?.message?.content || "";

    // Track token usage for entity extraction with context
    const inputTokens = data.usage?.prompt_tokens || estimateTokens(prompt);
    const outputTokens = data.usage?.completion_tokens || estimateTokens(responseText);
    await trackTokenUsage({
      model: GROK_MODEL,
      operation: "extract-entities-with-context",
      inputTokens,
      outputTokens,
      metadata: { hasUserContext: true },
    });

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("[ENTITY-EXTRACTION] No JSON in response");
      return { people: [], companies: [], properties: [], tags: [] };
    }

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      people: Array.isArray(parsed.people)
        ? parsed.people.filter((p: unknown) => typeof p === "string" && p.length > 1)
        : [],
      companies: Array.isArray(parsed.companies)
        ? parsed.companies.filter((c: unknown) => typeof c === "string" && c.length > 1)
        : [],
      properties: Array.isArray(parsed.properties)
        ? parsed.properties.filter((p: unknown) => p && typeof p === "object")
        : [],
      project: typeof parsed.project === "string" && parsed.project.length > 1
        ? parsed.project
        : undefined,
      tags: Array.isArray(parsed.tags)
        ? parsed.tags
            .filter((t: unknown) => typeof t === "string" && t.length > 1)
            .map((t: string) => t.toLowerCase().replace(/\s+/g, "-"))
        : [],
    };
  } catch (error) {
    console.error("[ENTITY-EXTRACTION] Failed:", error);
    return { people: [], companies: [], properties: [], tags: [] };
  }
}

// ============================================================================
// Project Suggestion Logic
// ============================================================================

export interface ProjectSuggestion {
  id: string;
  name: string;
  confidence: number; // 0-1
  reason: string;     // Why this was suggested
}

export interface ProjectSuggestionResult {
  suggestions: ProjectSuggestion[];
  shouldCreateNew: boolean;
  suggestedNewName: string | null;
}

/**
 * Suggest relevant projects to link a note to based on multiple signals
 *
 * Matching strategies (in order of confidence):
 * 1. Name matching - If extracted project name matches existing project (0.9)
 * 2. Entity overlap - If note shares people/companies with project notes (0.6-0.8)
 * 3. Keyword matching - If note content contains project name keywords (0.4-0.6)
 * 4. Semantic similarity - If note embedding is similar to project notes (0.3-0.5)
 */
export async function suggestProjectsForNote(
  noteId: string,
  userId: string,
  title: string,
  content: string,
  entities: ExtractedEntities
): Promise<ProjectSuggestionResult> {
  const suggestions: Map<string, ProjectSuggestion> = new Map();

  try {
    // Get existing project links to exclude
    const existingLinks = await getNoteProjectLinks(noteId);
    const existingLinkSet = new Set(existingLinks);

    // Get all user projects for matching
    const userProjects = await getUserProjects(userId);

    if (userProjects.length === 0) {
      // No projects exist yet - suggest creating one if entity extraction found a project
      return {
        suggestions: [],
        shouldCreateNew: !!entities.project,
        suggestedNewName: entities.project || null,
      };
    }

    // 1. Name matching (highest confidence)
    if (entities.project) {
      const normalizedExtracted = normalizeName(entities.project);
      for (const project of userProjects) {
        if (existingLinkSet.has(project.id)) continue;

        if (project.normalized_name === normalizedExtracted) {
          addOrUpdateSuggestion(suggestions, {
            id: project.id,
            name: project.name,
            confidence: 0.9,
            reason: `Extracted project name "${entities.project}" matches exactly`,
          });
        } else if (
          project.normalized_name.includes(normalizedExtracted) ||
          normalizedExtracted.includes(project.normalized_name)
        ) {
          addOrUpdateSuggestion(suggestions, {
            id: project.id,
            name: project.name,
            confidence: 0.75,
            reason: `Extracted project name "${entities.project}" partially matches`,
          });
        }
      }
    }

    // 2. Entity overlap (medium-high confidence)
    try {
      const sharedEntityProjects = await getProjectsWithSharedEntities(noteId, userId);

      for (const { project, overlapCount, sharedEntities } of sharedEntityProjects) {
        if (existingLinkSet.has(project.id)) continue;

        // Score based on overlap count: 0.6 for 1 entity, up to 0.85 for 4+
        const overlapScore = Math.min(0.6 + (overlapCount - 1) * 0.1, 0.85);
        const entityList = sharedEntities.slice(0, 3).join(", ");
        const suffix = sharedEntities.length > 3 ? ` +${sharedEntities.length - 3} more` : "";

        addOrUpdateSuggestion(suggestions, {
          id: project.id,
          name: project.name,
          confidence: overlapScore,
          reason: `Shares ${overlapCount} entities: ${entityList}${suffix}`,
        });
      }
    } catch (err) {
      console.warn("[PROJECT-SUGGEST] Entity overlap query failed:", err);
    }

    // 3. Keyword matching (medium confidence)
    const noteText = `${title} ${content}`.toLowerCase();
    for (const project of userProjects) {
      if (existingLinkSet.has(project.id)) continue;
      if (suggestions.has(project.id)) continue; // Skip if already suggested with higher confidence

      // Check if project name appears in note content
      const projectWords = project.name.toLowerCase().split(/\s+/);
      const matchingWords = projectWords.filter(
        (word) => word.length > 3 && noteText.includes(word)
      );

      if (matchingWords.length > 0) {
        const matchRatio = matchingWords.length / projectWords.length;
        const confidence = 0.4 + matchRatio * 0.2;

        addOrUpdateSuggestion(suggestions, {
          id: project.id,
          name: project.name,
          confidence,
          reason: `Content mentions: "${matchingWords.join('", "')}"`,
        });
      }
    }

    // 4. Semantic similarity (lower confidence, requires embeddings)
    try {
      const noteEmbedding = await getNoteEmbedding(noteId);
      if (noteEmbedding) {
        const similarProjects = await findSimilarProjects(noteEmbedding, userId, 5);

        for (const { project, similarity } of similarProjects) {
          if (existingLinkSet.has(project.id)) continue;
          if (suggestions.has(project.id)) continue; // Skip if already suggested

          // Map similarity (0.3-1.0) to confidence (0.3-0.5)
          const confidence = 0.3 + (similarity - 0.3) * 0.3;

          addOrUpdateSuggestion(suggestions, {
            id: project.id,
            name: project.name,
            confidence: Math.min(confidence, 0.5), // Cap at 0.5 for semantic-only matches
            reason: `Semantically similar (${Math.round(similarity * 100)}% match)`,
          });
        }
      }
    } catch (err) {
      console.warn("[PROJECT-SUGGEST] Semantic similarity failed:", err);
    }

    // Sort by confidence and take top 5
    const sortedSuggestions = Array.from(suggestions.values())
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);

    // Determine if we should suggest creating a new project
    const hasHighConfidenceMatch = sortedSuggestions.some((s) => s.confidence >= 0.7);
    const shouldCreateNew = !!entities.project && !hasHighConfidenceMatch;

    console.log(
      `[PROJECT-SUGGEST] Note ${noteId}: ${sortedSuggestions.length} suggestions, shouldCreateNew=${shouldCreateNew}`
    );

    return {
      suggestions: sortedSuggestions,
      shouldCreateNew,
      suggestedNewName: shouldCreateNew ? entities.project! : null,
    };
  } catch (error) {
    console.error("[PROJECT-SUGGEST] Failed:", error);
    return {
      suggestions: [],
      shouldCreateNew: !!entities.project,
      suggestedNewName: entities.project || null,
    };
  }
}

/**
 * Helper to add or update a suggestion, keeping the higher confidence one
 */
function addOrUpdateSuggestion(
  suggestions: Map<string, ProjectSuggestion>,
  suggestion: ProjectSuggestion
): void {
  const existing = suggestions.get(suggestion.id);
  if (!existing || existing.confidence < suggestion.confidence) {
    suggestions.set(suggestion.id, suggestion);
  }
}
