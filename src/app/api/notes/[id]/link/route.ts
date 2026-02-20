import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import {
  getNoteById,
  findOrCreatePerson,
  findOrCreateCompany,
  findOrCreateProject,
  linkPersonToNote,
  linkCompanyToNote,
  linkProjectToNote,
} from "@/lib/db";
import { getAuthUserId } from "@/lib/auth";
import { checkServiceAuth } from "@/lib/service-auth";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { dispatchWebhooks } from "@/lib/webhooks";

async function getUserId(request: NextRequest): Promise<string | null> {
  const userId = await getAuthUserId();
  if (userId) return userId;

  const serviceAuth = checkServiceAuth(request);
  if (serviceAuth.authenticated) return serviceAuth.userId;

  return null;
}

/**
 * POST /api/notes/[id]/link
 * Link a note to an entity (person, company, or project)
 * Body: { type: 'person'|'company'|'project', entityId?: string, name?: string }
 * - If entityId is provided, links to existing entity
 * - If name is provided, creates/finds entity by name and links
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: noteId } = await params;
    if (!noteId || typeof noteId !== "string") {
      return NextResponse.json({ error: "Invalid note ID" }, { status: 400 });
    }

    const rateLimit = checkRateLimit(`notes:link:${userId}`, {
      limit: 60,
      windowMs: 60000,
    });
    if (!rateLimit.success) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: rateLimitHeaders(rateLimit) }
      );
    }

    // Verify note belongs to user
    const note = await getNoteById(noteId, userId);
    if (!note) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    const body = await request.json();
    const { type, entityId, name } = body;

    if (!type || !["person", "company", "project"].includes(type)) {
      return NextResponse.json(
        { error: "type must be 'person', 'company', or 'project'" },
        { status: 400 }
      );
    }

    if (!entityId && !name) {
      return NextResponse.json(
        { error: "Either entityId or name is required" },
        { status: 400 }
      );
    }

    let linkedEntity: { id: string; name: string; isNew?: boolean };

    if (name) {
      // Create or find entity by name
      switch (type) {
        case "person":
          linkedEntity = await findOrCreatePerson(userId, name);
          await linkPersonToNote(noteId, linkedEntity.id);
          break;
        case "company":
          linkedEntity = await findOrCreateCompany(userId, name);
          await linkCompanyToNote(noteId, linkedEntity.id);
          break;
        case "project":
          linkedEntity = await findOrCreateProject(userId, name);
          await linkProjectToNote(noteId, linkedEntity.id);
          break;
        default:
          return NextResponse.json({ error: "Invalid type" }, { status: 400 });
      }
    } else {
      // Link existing entity by ID
      const sql = neon(process.env.DATABASE_URL!);
      let entityRows;

      switch (type) {
        case "person":
          entityRows = await sql`SELECT id, name FROM people WHERE id = ${entityId} AND user_id = ${userId}`;
          if (entityRows.length === 0) {
            return NextResponse.json({ error: "Person not found" }, { status: 404 });
          }
          linkedEntity = { id: entityRows[0].id as string, name: entityRows[0].name as string };
          await linkPersonToNote(noteId, entityId);
          break;
        case "company":
          entityRows = await sql`SELECT id, name FROM companies WHERE id = ${entityId} AND user_id = ${userId}`;
          if (entityRows.length === 0) {
            return NextResponse.json({ error: "Company not found" }, { status: 404 });
          }
          linkedEntity = { id: entityRows[0].id as string, name: entityRows[0].name as string };
          await linkCompanyToNote(noteId, entityId);
          break;
        case "project":
          entityRows = await sql`SELECT id, name FROM projects WHERE id = ${entityId} AND user_id = ${userId}`;
          if (entityRows.length === 0) {
            return NextResponse.json({ error: "Project not found" }, { status: 404 });
          }
          linkedEntity = { id: entityRows[0].id as string, name: entityRows[0].name as string };
          await linkProjectToNote(noteId, entityId);
          break;
        default:
          return NextResponse.json({ error: "Invalid type" }, { status: 400 });
      }
    }

    console.log(`[LINK] Linked ${type} "${linkedEntity.name}" to note ${noteId}`);

    // Fire webhook for project links
    if (type === "project") {
      dispatchWebhooks(userId, "note.project-linked", {
        note_id: noteId,
        project_id: linkedEntity.id,
        project_name: linkedEntity.name,
      }).catch(() => {});
    }

    return NextResponse.json(
      {
        success: true,
        noteId,
        linked: {
          type,
          id: linkedEntity.id,
          name: linkedEntity.name,
          isNew: linkedEntity.isNew || false,
        },
      },
      { headers: rateLimitHeaders(rateLimit) }
    );
  } catch (error) {
    console.error("[LINK] Error:", error);
    return NextResponse.json(
      { error: "Failed to link entity" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/notes/[id]/link
 * Unlink a note from an entity
 * Body: { type: 'person'|'company'|'project', entityId: string }
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: noteId } = await params;
    if (!noteId || typeof noteId !== "string") {
      return NextResponse.json({ error: "Invalid note ID" }, { status: 400 });
    }

    const rateLimit = checkRateLimit(`notes:unlink:${userId}`, {
      limit: 60,
      windowMs: 60000,
    });
    if (!rateLimit.success) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: rateLimitHeaders(rateLimit) }
      );
    }

    // Verify note belongs to user
    const note = await getNoteById(noteId, userId);
    if (!note) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    const body = await request.json();
    const { type, entityId } = body;

    if (!type || !["person", "company", "project"].includes(type)) {
      return NextResponse.json(
        { error: "type must be 'person', 'company', or 'project'" },
        { status: 400 }
      );
    }

    if (!entityId || typeof entityId !== "string") {
      return NextResponse.json(
        { error: "entityId is required and must be a string" },
        { status: 400 }
      );
    }

    const sql = neon(process.env.DATABASE_URL!);

    switch (type) {
      case "person":
        await sql`DELETE FROM note_people WHERE note_id = ${noteId} AND person_id = ${entityId}`;
        break;
      case "company":
        await sql`DELETE FROM note_companies WHERE note_id = ${noteId} AND company_id = ${entityId}`;
        break;
      case "project":
        await sql`DELETE FROM note_projects WHERE note_id = ${noteId} AND project_id = ${entityId}`;
        break;
    }

    console.log(`[UNLINK] Unlinked ${type} ${entityId} from note ${noteId}`);

    return NextResponse.json(
      {
        success: true,
        noteId,
        unlinked: { type, entityId },
      },
      { headers: rateLimitHeaders(rateLimit) }
    );
  } catch (error) {
    console.error("[UNLINK] Error:", error);
    return NextResponse.json(
      { error: "Failed to unlink entity" },
      { status: 500 }
    );
  }
}
