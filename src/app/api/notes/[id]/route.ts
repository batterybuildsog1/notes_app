import { NextRequest, NextResponse } from "next/server";
import { getNoteById, updateNote, deleteNote } from "@/lib/db";
import { getAuthUserId } from "@/lib/auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getAuthUserId();
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
    const userId = await getAuthUserId();
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
    const userId = await getAuthUserId();
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
