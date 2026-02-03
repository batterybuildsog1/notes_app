import { NextRequest, NextResponse } from "next/server";
import {
  getNoteById,
  createNote,
  deleteNote,
  getNoteEntities,
  linkPersonToNote,
  linkCompanyToNote,
  linkProjectToNote,
  updateNoteEmbedding,
} from "@/lib/db";
import { getAuthUserId } from "@/lib/auth";
import { checkServiceAuth } from "@/lib/service-auth";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { generateEmbedding } from "@/lib/enrichment";

async function getUserId(request: NextRequest): Promise<string | null> {
  const userId = await getAuthUserId();
  if (userId) return userId;

  const serviceAuth = checkServiceAuth(request);
  if (serviceAuth.authenticated) return serviceAuth.userId;

  return null;
}

interface SplitSpec {
  title: string;
  content: string;
  category?: string;
  tags?: string[];
}

/**
 * POST /api/notes/split
 * Split a note into multiple new notes
 * Body: {
 *   noteId: string,
 *   splits: [{ title, content, category?, tags? }, ...],
 *   deleteOriginal?: boolean (default: false)
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const userId = await getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit(`notes:split:${userId}`, {
      limit: 10,
      windowMs: 60000,
    });
    if (!rateLimit.success) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: rateLimitHeaders(rateLimit) }
      );
    }

    const body = await request.json();
    const { noteId, splits, deleteOriginal = false } = body;

    if (!noteId || typeof noteId !== "string") {
      return NextResponse.json(
        { error: "noteId is required and must be a string" },
        { status: 400 }
      );
    }

    if (!Array.isArray(splits) || splits.length < 1) {
      return NextResponse.json(
        { error: "splits must be a non-empty array" },
        { status: 400 }
      );
    }

    if (splits.length > 10) {
      return NextResponse.json(
        { error: "Maximum 10 splits per operation" },
        { status: 400 }
      );
    }

    // Validate each split
    for (let i = 0; i < splits.length; i++) {
      const split = splits[i] as SplitSpec;
      if (!split.title || typeof split.title !== "string") {
        return NextResponse.json(
          { error: `Split ${i}: title is required and must be a string` },
          { status: 400 }
        );
      }
      if (!split.content || typeof split.content !== "string") {
        return NextResponse.json(
          { error: `Split ${i}: content is required and must be a string` },
          { status: 400 }
        );
      }
    }

    // Verify original note exists and belongs to user
    const originalNote = await getNoteById(noteId, userId);
    if (!originalNote) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    // Get entities from original note to copy to new notes
    const originalEntities = await getNoteEntities(noteId);

    // Create new notes
    const createdNotes = [];
    for (const split of splits as SplitSpec[]) {
      const newNote = await createNote({
        title: split.title.trim(),
        content: split.content.trim(),
        user_id: userId,
        category: split.category?.trim() || originalNote.category || undefined,
        tags: split.tags || originalNote.tags || undefined,
        priority: originalNote.priority || undefined,
        project: originalNote.project || undefined,
      });

      // Copy entity links from original
      for (const person of originalEntities.people) {
        await linkPersonToNote(newNote.id, person.id);
      }
      for (const company of originalEntities.companies) {
        await linkCompanyToNote(newNote.id, company.id);
      }
      for (const project of originalEntities.projects) {
        await linkProjectToNote(newNote.id, project.id);
      }

      // Generate embedding for new note
      try {
        const embedding = await generateEmbedding(`${newNote.title}\n\n${newNote.content}`);
        if (embedding) {
          await updateNoteEmbedding(newNote.id, embedding);
        }
      } catch {
        // Non-fatal
      }

      createdNotes.push({
        ...newNote,
        people: originalEntities.people,
        companies: originalEntities.companies,
        projects: originalEntities.projects,
      });
    }

    // Delete original if requested
    let deleted = false;
    if (deleteOriginal) {
      await deleteNote(noteId, userId);
      deleted = true;
    }

    console.log(
      `[SPLIT] Split note ${noteId} into ${createdNotes.length} notes${deleted ? " (original deleted)" : ""}`
    );

    return NextResponse.json(
      {
        success: true,
        originalNoteId: noteId,
        originalDeleted: deleted,
        createdNotes,
      },
      { status: 201, headers: rateLimitHeaders(rateLimit) }
    );
  } catch (error) {
    console.error("[SPLIT] Error:", error);
    return NextResponse.json(
      { error: "Failed to split note" },
      { status: 500 }
    );
  }
}
