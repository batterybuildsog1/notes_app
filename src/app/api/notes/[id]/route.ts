import { NextRequest, NextResponse } from "next/server";
import { getNoteById, updateNote, deleteNote, updateNoteEmbedding } from "@/lib/db";
import { getAuthUserId } from "@/lib/auth";
import { checkServiceAuth } from "@/lib/service-auth";
import { enrichNote } from "@/lib/enrichment";

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
    const noteId = parseInt(id);
    if (isNaN(noteId) || noteId <= 0) {
      return NextResponse.json({ error: "Invalid note ID" }, { status: 400 });
    }

    const note = await getNoteById(noteId, userId);

    if (!note) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    return NextResponse.json(note);
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
    const noteId = parseInt(id);
    if (isNaN(noteId) || noteId <= 0) {
      return NextResponse.json({ error: "Invalid note ID" }, { status: 400 });
    }

    const body = await request.json();
    const { title, content, category, tags, priority, project } = body;

    const note = await updateNote(noteId, userId, {
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

    // Re-generate embedding if title or content changed
    if (title || content) {
      enrichNote(note.title, note.content, note.tags || [], note.category)
        .then(async (enrichment) => {
          if (enrichment.embedding) {
            await updateNoteEmbedding(note.id, enrichment.embedding);
            console.log(`[ENRICHMENT] Updated embedding for note ${note.id}`);
          }
        })
        .catch((err) => {
          console.error(`[ENRICHMENT] Failed for note ${note.id}:`, err);
        });
    }

    return NextResponse.json(note);
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
    const noteId = parseInt(id);
    if (isNaN(noteId) || noteId <= 0) {
      return NextResponse.json({ error: "Invalid note ID" }, { status: 400 });
    }

    await deleteNote(noteId, userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting note:", error);
    return NextResponse.json(
      { error: "Failed to delete note" },
      { status: 500 }
    );
  }
}
