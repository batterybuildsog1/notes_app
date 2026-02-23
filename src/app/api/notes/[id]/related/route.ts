/**
 * Related Notes API - Find notes similar to a given note
 * Uses embedding similarity + shared entity overlap.
 *
 * GET /api/notes/:id/related?limit=5
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth";
import { checkServiceAuth } from "@/lib/service-auth";
import { findRelatedNotes } from "@/lib/db";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    let userId = await getAuthUserId();

    if (!userId) {
      const serviceAuth = checkServiceAuth(request);
      if (serviceAuth.authenticated) {
        userId = serviceAuth.userId;
      }
    }

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: noteId } = await params;
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "5", 10);

    const related = await findRelatedNotes(noteId, userId, Math.min(limit, 20));

    return NextResponse.json({
      noteId,
      related: related.map((r) => ({
        ...r,
        similarity: parseFloat(r.similarity?.toString() || "0"),
      })),
    });
  } catch (error) {
    console.error("[RELATED-NOTES] Error:", error);
    return NextResponse.json(
      { error: "Failed to find related notes" },
      { status: 500 }
    );
  }
}
