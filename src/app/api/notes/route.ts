import { NextRequest, NextResponse } from "next/server";
import { getNotes, createNote, updateNoteEmbedding } from "@/lib/db";
import { getAuthUserId } from "@/lib/auth";
import { checkServiceAuth } from "@/lib/service-auth";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { enrichNote } from "@/lib/enrichment";

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

    const notes = await getNotes(userId, search, category);
    return NextResponse.json(notes, { headers: rateLimitHeaders(rateLimit) });
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

    // Enrichment: Generate embedding + tag suggestions (async, non-blocking)
    // Don't await - let it run in background
    enrichNote(title, content, tags || [], category || null)
      .then(async (enrichment) => {
        if (enrichment.embedding) {
          await updateNoteEmbedding(note.id, enrichment.embedding);
          console.log(`[ENRICHMENT] Generated embedding for note ${note.id}`);
        }
        if (enrichment.suggestedTags.length > 0) {
          console.log(`[ENRICHMENT] Suggested tags for note ${note.id}:`, enrichment.suggestedTags);
          // Tags are just logged for now - could be stored as suggestions
        }
        if (enrichment.suggestedCategory) {
          console.log(`[ENRICHMENT] Suggested category for note ${note.id}:`, enrichment.suggestedCategory);
        }
      })
      .catch((err) => {
        console.error(`[ENRICHMENT] Failed for note ${note.id}:`, err);
      });

    return NextResponse.json(note, {
      status: 201,
      headers: rateLimitHeaders(rateLimit),
    });
  } catch (error) {
    console.error("Error creating note:", error);
    return NextResponse.json(
      { error: "Failed to create note" },
      { status: 500 }
    );
  }
}
