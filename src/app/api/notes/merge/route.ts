import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import {
  getNoteById,
  createNote,
  deleteNote,
  getNoteEntities,
  linkPersonToNote,
  linkCompanyToNote,
  linkProjectToNote,
  updateNoteEmbedding,
  Note,
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

/**
 * POST /api/notes/merge
 * Merge multiple notes into a single new note
 * Body: {
 *   noteIds: string[],
 *   newTitle: string,
 *   separator?: string (default: "\n\n---\n\n")
 * }
 *
 * - Combines content with separator
 * - Merges all entity links (people, companies, projects)
 * - Merges tags (deduplicated)
 * - Deletes original notes after successful merge
 */
export async function POST(request: NextRequest) {
  try {
    const userId = await getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit(`notes:merge:${userId}`, {
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
    const { noteIds, newTitle, separator = "\n\n---\n\n" } = body;

    if (!Array.isArray(noteIds) || noteIds.length < 2) {
      return NextResponse.json(
        { error: "noteIds must be an array with at least 2 note IDs" },
        { status: 400 }
      );
    }

    if (noteIds.length > 20) {
      return NextResponse.json(
        { error: "Maximum 20 notes per merge operation" },
        { status: 400 }
      );
    }

    if (!newTitle || typeof newTitle !== "string" || newTitle.trim().length < 1) {
      return NextResponse.json(
        { error: "newTitle is required and must be a non-empty string" },
        { status: 400 }
      );
    }

    // Fetch all notes and verify ownership
    const notes: Note[] = [];
    for (const id of noteIds) {
      if (typeof id !== "string") {
        return NextResponse.json(
          { error: "All noteIds must be strings" },
          { status: 400 }
        );
      }
      const note = await getNoteById(id, userId);
      if (!note) {
        return NextResponse.json(
          { error: `Note not found: ${id}` },
          { status: 404 }
        );
      }
      notes.push(note);
    }

    // Collect all entities from source notes
    const allPeopleIds = new Set<string>();
    const allCompanyIds = new Set<string>();
    const allProjectIds = new Set<string>();
    const allTags = new Set<string>();

    for (const note of notes) {
      const entities = await getNoteEntities(note.id);
      entities.people.forEach((p) => allPeopleIds.add(p.id));
      entities.companies.forEach((c) => allCompanyIds.add(c.id));
      entities.projects.forEach((pr) => allProjectIds.add(pr.id));
      note.tags?.forEach((t) => allTags.add(t));
    }

    // Combine content
    const combinedContent = notes
      .map((n) => `## ${n.title}\n\n${n.content}`)
      .join(separator);

    // Use earliest original_created_at if available
    const earliestOriginalCreated = notes
      .filter((n) => n.original_created_at)
      .sort((a, b) => {
        const aTime = new Date(a.original_created_at!).getTime();
        const bTime = new Date(b.original_created_at!).getTime();
        return aTime - bTime;
      })[0]?.original_created_at;

    // Create merged note
    const mergedNote = await createNote({
      title: newTitle.trim(),
      content: combinedContent,
      user_id: userId,
      category: notes[0].category || undefined,
      tags: allTags.size > 0 ? Array.from(allTags) : undefined,
      priority: notes[0].priority || undefined,
      project: notes[0].project || undefined,
      original_created_at: earliestOriginalCreated || undefined,
    });

    // Link all entities to merged note
    for (const personId of allPeopleIds) {
      await linkPersonToNote(mergedNote.id, personId);
    }
    for (const companyId of allCompanyIds) {
      await linkCompanyToNote(mergedNote.id, companyId);
    }
    for (const projectId of allProjectIds) {
      await linkProjectToNote(mergedNote.id, projectId);
    }

    // Mark as enriched
    const sql = neon(process.env.DATABASE_URL!);
    await sql`UPDATE notes SET enriched_at = NOW() WHERE id = ${mergedNote.id}`;

    // Generate embedding for merged content
    try {
      const embedding = await generateEmbedding(`${mergedNote.title}\n\n${mergedNote.content}`);
      if (embedding) {
        await updateNoteEmbedding(mergedNote.id, embedding);
      }
    } catch {
      // Non-fatal
    }

    // Delete original notes
    for (const note of notes) {
      await deleteNote(note.id, userId);
    }

    // Get final entities for response
    const finalEntities = await getNoteEntities(mergedNote.id);

    console.log(
      `[MERGE] Merged ${notes.length} notes into ${mergedNote.id} (${allPeopleIds.size} people, ${allCompanyIds.size} companies, ${allProjectIds.size} projects)`
    );

    return NextResponse.json(
      {
        success: true,
        deletedNoteIds: noteIds,
        mergedNote: {
          ...mergedNote,
          people: finalEntities.people,
          companies: finalEntities.companies,
          projects: finalEntities.projects,
        },
      },
      { status: 201, headers: rateLimitHeaders(rateLimit) }
    );
  } catch (error) {
    console.error("[MERGE] Error:", error);
    return NextResponse.json(
      { error: "Failed to merge notes" },
      { status: 500 }
    );
  }
}
