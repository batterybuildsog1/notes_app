/**
 * Token Usage API
 *
 * GET /api/usage - Get token usage statistics
 * Query params:
 *   - period: "today" | "week" | "month" | "all" (default: "today")
 *   - noteId: UUID - Get usage for specific note
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth";
import { checkServiceAuth } from "@/lib/service-auth";
import {
  getDailyUsage,
  getWeeklyUsage,
  getMonthlyUsage,
  getAllTimeUsage,
  getNoteCost,
} from "@/lib/token-tracking";

async function getUserId(request: NextRequest): Promise<string | null> {
  const userId = await getAuthUserId();
  if (userId) return userId;

  const serviceAuth = checkServiceAuth(request);
  if (serviceAuth.authenticated) return serviceAuth.userId;

  return null;
}

export async function GET(request: NextRequest) {
  try {
    const userId = await getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "today";
    const noteId = searchParams.get("noteId");

    // If noteId provided, get usage for that specific note
    if (noteId) {
      const noteCost = await getNoteCost(noteId);
      return NextResponse.json({
        period: "note",
        noteId,
        ...noteCost,
        timestamp: new Date().toISOString(),
      });
    }

    // Get usage for the specified period
    let usage;
    switch (period) {
      case "today":
        usage = await getDailyUsage();
        break;
      case "week":
        usage = await getWeeklyUsage();
        break;
      case "month":
        usage = await getMonthlyUsage();
        break;
      case "all":
        usage = await getAllTimeUsage();
        break;
      default:
        return NextResponse.json(
          { error: "Invalid period. Use: today, week, month, or all" },
          { status: 400 }
        );
    }

    return NextResponse.json({
      period,
      ...usage,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching usage:", error);
    return NextResponse.json(
      { error: "Failed to fetch usage statistics" },
      { status: 500 }
    );
  }
}
