import { NextRequest, NextResponse } from "next/server";
import {
  getNoteById,
  updateNote,
  getPendingClarificationForNote,
  answerClarification,
  markClarificationApplied as dbMarkClarificationApplied,
  getPendingClarifications,
  updateNoteEmbedding,
} from "@/lib/db";
import { getAuthUserId } from "@/lib/auth";
import { checkServiceAuth } from "@/lib/service-auth";
import {
  extractEntitiesWithContext,
  linkEntitiesToNote,
  entitiesToTags,
} from "@/lib/entity-extraction";
import { generateEmbedding } from "@/lib/enrichment";
import { neon } from "@neondatabase/serverless";

async function getUserId(request: NextRequest): Promise<string | null> {
  const userId = await getAuthUserId();
  if (userId) return userId;

  const serviceAuth = checkServiceAuth(request);
  if (serviceAuth.authenticated) return serviceAuth.userId;

  return null;
}

/**
 * POST /api/notes/clarify
 * Receives user context for a pending clarification and applies enrichment
 */
export async function POST(request: NextRequest) {
  try {
    const userId = await getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { noteId, context } = body;

    if (!noteId || typeof noteId !== "string") {
      return NextResponse.json(
        { error: "noteId is required and must be a string" },
        { status: 400 }
      );
    }

    if (!context || typeof context !== "string") {
      return NextResponse.json(
        { error: "context is required and must be a string" },
        { status: 400 }
      );
    }

    // Verify note belongs to user
    const note = await getNoteById(noteId, userId);
    if (!note) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    // Update clarification in database
    const clarification = await getPendingClarificationForNote(noteId);
    if (clarification) {
      await answerClarification(noteId, context);
    }

    // Re-run entity extraction with user context
    const entities = await extractEntitiesWithContext(
      note.title,
      note.content,
      context
    );

    // Link entities to note (CRM-style)
    const linkedEntities = await linkEntitiesToNote(noteId, userId, entities);

    // Convert entities to tags for backward compatibility
    const entityTags = entitiesToTags(entities);

    // Build updates
    const updates: { category?: string; tags?: string[]; project?: string } = {};

    // Merge tags
    const existingTags = note.tags || [];
    const newTags = entityTags.filter((t) => !existingTags.includes(t));
    if (newTags.length > 0) {
      updates.tags = [...existingTags, ...newTags];
    }

    // Apply project if found
    if (entities.project && !note.project) {
      updates.project = entities.project;
    }

    // Update note
    let updatedNote = note;
    if (Object.keys(updates).length > 0) {
      const result = await updateNote(noteId, userId, updates);
      if (result) {
        updatedNote = result;
      }
    }

    // Mark as enriched now that we have context
    const sql = neon(process.env.DATABASE_URL!);
    await sql`UPDATE notes SET enriched_at = NOW() WHERE id = ${noteId}`;

    // Regenerate embedding with context if needed
    try {
      const fullText = `${note.title}\n\n${note.content}\n\nContext: ${context}`;
      const embedding = await generateEmbedding(fullText);
      if (embedding) {
        await updateNoteEmbedding(noteId, embedding);
      }
    } catch {
      // Non-fatal
    }

    // Mark clarification as applied
    await dbMarkClarificationApplied(noteId);

    console.log(
      `[CLARIFY] Applied enrichment to note ${noteId}:`,
      {
        tags: updates.tags?.length || 0,
        project: updates.project,
        people: linkedEntities.people.length,
        companies: linkedEntities.companies.length,
        projects: linkedEntities.projects.length,
      }
    );

    return NextResponse.json({
      success: true,
      note: {
        ...updatedNote,
        people: linkedEntities.people,
        companies: linkedEntities.companies,
        projects: linkedEntities.projects,
      },
      applied: {
        tags: updates.tags || null,
        project: updates.project || null,
        linkedPeople: linkedEntities.people.length,
        linkedCompanies: linkedEntities.companies.length,
        linkedProjects: linkedEntities.projects.length,
      },
    });
  } catch (error) {
    console.error("[CLARIFY] Error:", error);
    return NextResponse.json(
      { error: "Failed to process clarification" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/notes/clarify
 * List pending clarifications from database
 */
export async function GET(request: NextRequest) {
  try {
    const userId = await getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const pending = await getPendingClarifications(userId);

    return NextResponse.json({ pending });
  } catch (error) {
    console.error("[CLARIFY] Get pending error:", error);
    return NextResponse.json(
      { error: "Failed to get pending clarifications" },
      { status: 500 }
    );
  }
}
