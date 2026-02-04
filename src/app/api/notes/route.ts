import { NextRequest, NextResponse } from "next/server";
import {
  getNotesWithEntities,
  getNotesByEntity,
  createNote,
  updateNoteEmbedding,
  createClarification,
  updateClarificationTelegramId,
  getNoteEntities,
  NoteWithEntities,
  getTemplateById,
  queueForEnrichment,
} from "@/lib/db";
import { getAuthUserId } from "@/lib/auth";
import { checkServiceAuth } from "@/lib/service-auth";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { generateEmbedding, assessNoteClarity } from "@/lib/enrichment";
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
    const limit = parseInt(searchParams.get("limit") || "30", 10);
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    // Entity filters
    const personId = searchParams.get("person") || undefined;
    const companyId = searchParams.get("company") || undefined;
    const projectId = searchParams.get("project") || undefined;

    // Get notes with entities in a single query (no N+1!)
    let notesWithEntities: NoteWithEntities[];
    if (personId) {
      // Entity filters still need the old pattern (less common, fewer results)
      const notes = await getNotesByEntity(userId, "person", personId);
      notesWithEntities = await Promise.all(
        notes.map(async (note) => {
          const entities = await getNoteEntities(note.id);
          return { ...note, ...entities };
        })
      );
    } else if (companyId) {
      const notes = await getNotesByEntity(userId, "company", companyId);
      notesWithEntities = await Promise.all(
        notes.map(async (note) => {
          const entities = await getNoteEntities(note.id);
          return { ...note, ...entities };
        })
      );
    } else if (projectId) {
      const notes = await getNotesByEntity(userId, "project", projectId);
      notesWithEntities = await Promise.all(
        notes.map(async (note) => {
          const entities = await getNoteEntities(note.id);
          return { ...note, ...entities };
        })
      );
    } else {
      // Main path: single query with JOINs
      notesWithEntities = await getNotesWithEntities(userId, search, category, { limit, offset });
    }

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
    let { title, content, category, tags, priority, project, original_created_at, original_updated_at, templateId } = body;

    // If templateId provided, load template and use as defaults
    if (templateId) {
      const template = await getTemplateById(templateId, userId);
      if (!template) {
        return NextResponse.json(
          { error: "Template not found" },
          { status: 404 }
        );
      }

      // Use template values as defaults, user-provided values override
      title = title || template.title_template;
      content = content || template.content_template;
      category = category || template.default_category;
      tags = tags || template.default_tags;
    }

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

    // FAST RETURN: Send response immediately, enrich in background
    // This makes note creation feel instant (<100ms)
    const response = NextResponse.json(
      { ...note, enrichment_status: "pending" },
      { status: 201, headers: rateLimitHeaders(rateLimit) }
    );

    // Fire-and-forget: Queue enrichment without blocking response
    // All slow operations (clarity check, Telegram, embedding) happen async
    queueForEnrichment(note.id, userId).catch(err => {
      console.error(`[ENRICHMENT] Failed to queue note ${note.id}:`, err);
    });

    return response;
  } catch (error) {
    console.error("Error creating note:", error);
    return NextResponse.json(
      { error: "Failed to create note" },
      { status: 500 }
    );
  }
}
