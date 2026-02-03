import { NextRequest, NextResponse } from "next/server";
import { getNoteById, getNoteEntities } from "@/lib/db";
import { getAuthUserId } from "@/lib/auth";
import { checkServiceAuth } from "@/lib/service-auth";
import { suggestProjectsForNote, ExtractedEntities } from "@/lib/entity-extraction";

async function getUserId(request: NextRequest): Promise<string | null> {
  const userId = await getAuthUserId();
  if (userId) return userId;

  const serviceAuth = checkServiceAuth(request);
  if (serviceAuth.authenticated) return serviceAuth.userId;

  return null;
}

/**
 * GET /api/notes/[id]/suggest-projects
 * Returns project suggestions for a note based on:
 * - Extracted project name matching
 * - Shared entities with other project notes
 * - Keyword matching
 * - Semantic similarity
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "Invalid note ID" }, { status: 400 });
    }

    // Get the note
    const note = await getNoteById(id, userId);
    if (!note) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    // Get linked entities to build ExtractedEntities for suggestion logic
    const entities = await getNoteEntities(id);

    // Build ExtractedEntities from linked entities
    const extractedEntities: ExtractedEntities = {
      people: entities.people.map((p) => p.name),
      companies: entities.companies.map((c) => c.name),
      properties: [],
      project: note.project || undefined,
      tags: note.tags || [],
    };

    // Get suggestions
    const result = await suggestProjectsForNote(
      id,
      userId,
      note.title,
      note.content,
      extractedEntities
    );

    return NextResponse.json({
      noteId: id,
      noteTitle: note.title,
      ...result,
    });
  } catch (error) {
    console.error("[SUGGEST-PROJECTS] Error:", error);
    return NextResponse.json(
      { error: "Failed to get project suggestions" },
      { status: 500 }
    );
  }
}
