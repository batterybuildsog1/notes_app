import { NextRequest, NextResponse } from "next/server";
import {
  getNotes,
  getNotesByEntity,
  createNote,
  updateNote,
  updateNoteEmbedding,
  createClarification,
  updateClarificationTelegramId,
  getNoteEntities,
  NoteWithEntities,
} from "@/lib/db";
import { getAuthUserId } from "@/lib/auth";
import { checkServiceAuth } from "@/lib/service-auth";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { generateEmbedding, assessNoteClarity } from "@/lib/enrichment";
import {
  enrichWithEntities,
  linkEntitiesToNote,
  LinkedEntities,
  suggestProjectsForNote,
  ProjectSuggestionResult,
} from "@/lib/entity-extraction";
import { sendTelegramMessage, isTelegramConfigured } from "@/lib/telegram";

async function getUserId(request: NextRequest): Promise<string | null> {
  // Try session auth first
  const userId = await getAuthUserId();
  if (userId) return userId;

  // Fall back to service auth
  const serviceAuth = checkServiceAuth(request);
  if (serviceAuth.authenticated) return serviceAuth.userId;

  return null;
}

export async function GET(request: NextRequest) {
  try {
    const userId = await getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Rate limit: 100 requests per minute per user
    const rateLimit = checkRateLimit(`notes:get:${userId}`, {
      limit: 100,
      windowMs: 60000,
    });
    if (!rateLimit.success) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: rateLimitHeaders(rateLimit) }
      );
    }

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || undefined;
    const category = searchParams.get("category") || undefined;

    // Entity filters
    const personId = searchParams.get("person") || undefined;
    const companyId = searchParams.get("company") || undefined;
    const projectId = searchParams.get("project") || undefined;

    // Get notes - either filtered by entity or by search/category
    let notes;
    if (personId) {
      notes = await getNotesByEntity(userId, "person", personId);
    } else if (companyId) {
      notes = await getNotesByEntity(userId, "company", companyId);
    } else if (projectId) {
      notes = await getNotesByEntity(userId, "project", projectId);
    } else {
      notes = await getNotes(userId, search, category);
    }

    // Fetch linked entities for each note
    const notesWithEntities: NoteWithEntities[] = await Promise.all(
      notes.map(async (note) => {
        try {
          const entities = await getNoteEntities(note.id);
          return { ...note, ...entities };
        } catch {
          return note;
        }
      })
    );

    return NextResponse.json(notesWithEntities, { headers: rateLimitHeaders(rateLimit) });
  } catch (error) {
    console.error("Error fetching notes:", error);
    return NextResponse.json(
      { error: "Failed to fetch notes" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Rate limit: 30 creates per minute per user
    const rateLimit = checkRateLimit(`notes:create:${userId}`, {
      limit: 30,
      windowMs: 60000,
    });
    if (!rateLimit.success) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: rateLimitHeaders(rateLimit) }
      );
    }

    const body = await request.json();
    const { title, content, category, tags, priority, project, original_created_at, original_updated_at } = body;

    // Input validation
    if (!title || typeof title !== "string") {
      return NextResponse.json(
        { error: "Title is required and must be a string" },
        { status: 400 }
      );
    }
    if (!content || typeof content !== "string") {
      return NextResponse.json(
        { error: "Content is required and must be a string" },
        { status: 400 }
      );
    }
    if (title.length > 500) {
      return NextResponse.json(
        { error: "Title must be 500 characters or less" },
        { status: 400 }
      );
    }
    if (content.length > 100000) {
      return NextResponse.json(
        { error: "Content must be 100,000 characters or less" },
        { status: 400 }
      );
    }

    const note = await createNote({
      title: title.trim(),
      content: content.trim(),
      user_id: userId,
      category: category?.trim(),
      tags: Array.isArray(tags) ? tags.map((t: string) => t.trim()) : undefined,
      priority: priority?.trim(),
      project: project?.trim(),
      original_created_at: original_created_at || undefined,
      original_updated_at: original_updated_at || undefined,
    });

    // Step 1: Assess vagueness BEFORE full enrichment
    let enrichmentStatus = "completed";
    try {
      const clarity = await assessNoteClarity(title, content);

      if (clarity.needsClarification && clarity.question && isTelegramConfigured()) {
        // Store clarification in database
        await createClarification(note.id, userId, clarity.question);

        // Send question via Telegram
        const result = await sendTelegramMessage(
          `❓ *New Note Needs Context*\n\n"${title}"\n\n${clarity.question}`,
          { parseMode: "Markdown" }
        );

        if (result.messageId) {
          await updateClarificationTelegramId(note.id, result.messageId);
        }

        console.log(`[ENRICHMENT] Note ${note.id} needs clarification: ${clarity.question}`);
        enrichmentStatus = "pending_clarification";

        // Still generate embedding (content won't change)
        const embedding = await generateEmbedding(`${title}\n\n${content}`);
        if (embedding) {
          await updateNoteEmbedding(note.id, embedding);
        }

        // Return early - skip full enrichment until user responds
        return NextResponse.json(
          { ...note, enrichment_status: enrichmentStatus },
          { status: 201, headers: rateLimitHeaders(rateLimit) }
        );
      }
    } catch (err) {
      console.warn(`[ENRICHMENT] Vagueness check failed for note ${note.id}:`, err);
      // Continue with full enrichment if vagueness check fails
    }

    // Step 2: Full enrichment for clear notes
    let enrichedNote = note;
    let linkedEntities: LinkedEntities = { people: [], companies: [], projects: [] };
    let projectSuggestions: ProjectSuggestionResult = {
      suggestions: [],
      shouldCreateNew: false,
      suggestedNewName: null,
    };

    try {
      // Run entity extraction + embedding in parallel
      const [enrichment, embedding] = await Promise.all([
        enrichWithEntities(title, content, tags || []),
        generateEmbedding(`${title}\n\n${content}`),
      ]);

      console.log(`[ENRICHMENT] Entities for note ${note.id}:`, enrichment);

      // Build updates
      const updates: { tags?: string[]; project?: string; title?: string } = {};

      // Apply entity tags
      if (enrichment.tags.length > (tags?.length || 0)) {
        updates.tags = enrichment.tags;
      }

      // Apply project if found
      if (enrichment.project && !project) {
        updates.project = enrichment.project;
      }

      // Apply auto-title if needed
      if (enrichment.newTitle) {
        const isUntitled = !title ||
          title.toLowerCase() === "untitled" ||
          title.trim().length < 3;
        if (isUntitled) {
          updates.title = enrichment.newTitle;
        }
      }

      // Update note with enrichment
      if (Object.keys(updates).length > 0) {
        const updated = await updateNote(note.id, userId, updates);
        if (updated) {
          enrichedNote = updated;
        }
        console.log(`[ENRICHMENT] Applied to note ${note.id}:`, updates);
      }

      // Link entities to note (CRM-style)
      if (enrichment.entities) {
        linkedEntities = await linkEntitiesToNote(note.id, userId, enrichment.entities);
      }

      // Mark as enriched + store embedding
      const { neon } = await import("@neondatabase/serverless");
      const sql = neon(process.env.DATABASE_URL!);
      await sql`UPDATE notes SET enriched_at = NOW() WHERE id = ${note.id}`;

      if (embedding) {
        await updateNoteEmbedding(note.id, embedding);
        console.log(`[ENRICHMENT] Embedding generated for note ${note.id}`);
      }

      // Get project suggestions based on enrichment
      try {
        projectSuggestions = await suggestProjectsForNote(
          note.id,
          userId,
          enrichedNote.title,
          enrichedNote.content,
          enrichment.entities
        );
        console.log(
          `[ENRICHMENT] Project suggestions for note ${note.id}:`,
          projectSuggestions.suggestions.length,
          "suggestions"
        );
      } catch (suggestErr) {
        console.warn(`[ENRICHMENT] Project suggestion failed for note ${note.id}:`, suggestErr);
      }
    } catch (err) {
      console.error(`[ENRICHMENT] Failed for note ${note.id}:`, err);
      // Continue - return the note even if enrichment failed
    }

    return NextResponse.json(
      {
        ...enrichedNote,
        people: linkedEntities.people,
        companies: linkedEntities.companies,
        projects: linkedEntities.projects,
        enrichment_status: enrichmentStatus,
        project_suggestions: projectSuggestions,
      },
      { status: 201, headers: rateLimitHeaders(rateLimit) }
    );
  } catch (error) {
    console.error("Error creating note:", error);
    return NextResponse.json(
      { error: "Failed to create note" },
      { status: 500 }
    );
  }
}
