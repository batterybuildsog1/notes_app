import { NextRequest, NextResponse } from "next/server";
import {
  getNotesWithEntities,
  createNote,
  upsertNoteByExternalEventId,
  NoteWithEntities,
  getTemplateById,
  queueForEnrichment,
} from "@/lib/db";
import { getAuthUserId } from "@/lib/auth";
import { checkServiceAuth } from "@/lib/service-auth";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { dispatchWebhooks } from "@/lib/webhooks";

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
    const projectExternalId = searchParams.get("projectExternalId") || undefined;
    const source = searchParams.get("source") || undefined;

    // Single query path for main list + entity filters (no N+1)
    const notesWithEntities: NoteWithEntities[] = await getNotesWithEntities(
      userId,
      search,
      category,
      {
        limit,
        offset,
        personId,
        companyId,
        projectId,
        projectExternalId,
        source,
      }
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
    let { title, content, category, tags } = body;
    const { priority, project, source, external_event_id, original_created_at, original_updated_at, templateId } = body;

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

    // Input validation - allow blank title, default to "Untitled"
    if (title && typeof title !== "string") {
      return NextResponse.json(
        { error: "Title must be a string" },
        { status: 400 }
      );
    }
    if (content && typeof content !== "string") {
      return NextResponse.json(
        { error: "Content must be a string" },
        { status: 400 }
      );
    }
    title = title?.trim() || "Untitled";
    content = content || "";
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

    let note;
    let wasCreated = true;

    // If external_event_id provided, use upsert for deduplication
    if (external_event_id && typeof external_event_id === "string") {
      const result = await upsertNoteByExternalEventId({
        title,
        content: content.trim(),
        user_id: userId,
        external_event_id: external_event_id.trim(),
        category: category?.trim(),
        tags: Array.isArray(tags) ? tags.map((t: string) => t.trim()) : undefined,
        priority: priority?.trim(),
        project: project?.trim(),
        source: source?.trim(),
      });
      note = result.note;
      wasCreated = result.created;
    } else {
      note = await createNote({
        title,
        content: content.trim(),
        user_id: userId,
        category: category?.trim(),
        tags: Array.isArray(tags) ? tags.map((t: string) => t.trim()) : undefined,
        priority: priority?.trim(),
        project: project?.trim(),
        source: source?.trim(),
        external_event_id: undefined,
        original_created_at: original_created_at || undefined,
        original_updated_at: original_updated_at || undefined,
      });
    }

    // FAST RETURN: Send response immediately, enrich in background
    const response = NextResponse.json(
      { ...note, enrichment_status: "pending" },
      { status: wasCreated ? 201 : 200, headers: rateLimitHeaders(rateLimit) }
    );

    // Fire-and-forget: Queue enrichment without blocking response
    queueForEnrichment(note.id, userId).catch(err => {
      console.error(`[ENRICHMENT] Failed to queue note ${note.id}:`, err);
    });

    // Fire webhooks (non-blocking)
    dispatchWebhooks(userId, wasCreated ? "note.created" : "note.updated", {
      note_id: note.id,
      title: note.title,
      category: note.category,
      source: note.source,
      external_event_id: note.external_event_id,
    }).catch(() => {});

    return response;
  } catch (error) {
    console.error("Error creating note:", error);
    return NextResponse.json(
      { error: "Failed to create note" },
      { status: 500 }
    );
  }
}
