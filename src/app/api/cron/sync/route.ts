/**
 * Vercel Cron - Auto Sync
 * Runs automatically via Vercel Cron to sync with Notion
 * 
 * Protected by CRON_SECRET header
 */

import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // Verify cron secret (Vercel sets this automatically for cron jobs)
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Call the sync API internally
    const syncUrl = new URL("/api/sync/notion", request.url);
    const response = await fetch(syncUrl.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": process.env.SERVICE_API_KEY || "",
      },
      body: JSON.stringify({ direction: "both" }),
    });

    const result = await response.json();

    console.log("[Cron Sync]", JSON.stringify(result));

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      sync: result,
    });
  } catch (error) {
    console.error("[Cron Sync Error]", error);
    return NextResponse.json(
      { 
        ok: false, 
        error: error instanceof Error ? error.message : "Unknown error" 
      },
      { status: 500 }
    );
  }
}
