import { NextRequest, NextResponse } from "next/server";
import { getNoteStats, getNotesUpdatedSince } from "@/lib/db";
import { getAuthUserId } from "@/lib/auth";
import { checkServiceAuth } from "@/lib/service-auth";

async function getUserId(request: NextRequest): Promise<string | null> {
  const userId = await getAuthUserId();
  if (userId) return userId;

  const serviceAuth = checkServiceAuth(request);
  if (serviceAuth.authenticated) return serviceAuth.userId;

  return null;
}

/**
 * Get note statistics
 * GET /api/notes/stats?since=2024-01-01
 */
export async function GET(request: NextRequest) {
  try {
    const userId = await getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const sinceParam = searchParams.get("since");

    const stats = await getNoteStats(userId);

    // If since param provided, also get recently updated notes
    let recentNotes: { id: number; title: string; updated_at: Date }[] = [];
    if (sinceParam) {
      const sinceDate = new Date(sinceParam);
      if (!isNaN(sinceDate.getTime())) {
        const notes = await getNotesUpdatedSince(userId, sinceDate);
        recentNotes = notes.map((n) => ({
          id: n.id,
          title: n.title,
          updated_at: n.updated_at,
        }));
      }
    }

    return NextResponse.json({
      stats,
      recentNotes,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch stats" },
      { status: 500 }
    );
  }
}
