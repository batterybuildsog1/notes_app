import { NextRequest, NextResponse } from "next/server";
import { getNoteById, updateNote, deleteNote, updateNoteEmbedding, getNoteEntities } from "@/lib/db";
import { getAuthUserId } from "@/lib/auth";
import { checkServiceAuth } from "@/lib/service-auth";
import { enrichNote } from "@/lib/enrichment";
import { enrichWithEntities, linkEntitiesToNote, LinkedEntities } from "@/lib/entity-extraction";
import { dispatchWebhooks } from "@/lib/webhooks";

async function getUserId(request: NextRequest): Promise<string | null> {
  const userId = await getAuthUserId();
  if (userId) return userId;

  const serviceAuth = checkServiceAuth(request);
  if (serviceAuth.authenticated) return serviceAuth.userId;

  return null;
}

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

    const note = await getNoteById(id, userId);

    if (!note) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    // Include linked entities
    const entities = await getNoteEntities(id);

    return NextResponse.json({ ...note, ...entities });
  } catch (error) {
    console.error("Error fetching note:", error);
    return NextResponse.json(
      { error: "Failed to fetch note" },
      { status: 500 }
    );
  }
}

export async function PUT(
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

    const body = await request.json();
    const { title, content, category, tags, priority, project } = body;

    const note = await updateNote(id, userId, {
      title,
      content,
      category,
      tags,
      priority,
      project,
    });

    if (!note) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    // Re-enrich if title or content changed
    let linkedEntities: LinkedEntities = { people: [], companies: [], projects: [] };
    if (title || content) {
      try {
        // Run entity extraction + embedding
        const [entityEnrichment, enrichment] = await Promise.all([
          enrichWithEntities(note.title, note.content, note.tags || []),
          enrichNote(note.title, note.content, note.tags || [], note.category),
        ]);

        // Link new entities (existing links preserved via ON CONFLICT DO NOTHING)
        if (entityEnrichment.entities) {
          linkedEntities = await linkEntitiesToNote(note.id, userId, entityEnrichment.entities);
        }

        if (enrichment.embedding) {
          await updateNoteEmbedding(note.id, enrichment.embedding);
          console.log(`[ENRICHMENT] Updated embedding for note ${note.id}`);
        }
      } catch (err) {
        console.error(`[ENRICHMENT] Failed for note ${note.id}:`, err);
      }
    } else {
      // Fetch existing entities if no content change
      const entities = await getNoteEntities(id);
      linkedEntities = entities;
    }

    // Fire webhook (non-blocking)
    dispatchWebhooks(userId, "note.updated", {
      note_id: note.id,
      title: note.title,
      category: note.category,
      source: note.source,
    }).catch(() => {});

    return NextResponse.json({
      ...note,
      people: linkedEntities.people,
      companies: linkedEntities.companies,
      projects: linkedEntities.projects,
    });
  } catch (error) {
    console.error("Error updating note:", error);
    return NextResponse.json(
      { error: "Failed to update note" },
      { status: 500 }
    );
  }
}

export async function DELETE(
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

    await deleteNote(id, userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting note:", error);
    return NextResponse.json(
      { error: "Failed to delete note" },
      { status: 500 }
    );
  }
}
