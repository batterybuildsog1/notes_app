import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

/**
 * Health check endpoint for monitoring
 * GET /api/health
 */
export async function GET() {
  const checks: Record<string, boolean> = {
    app: true,
    database: false,
    sync: true,
    enrichmentQueue: true,
  };

  const details: Record<string, unknown> = {};

  try {
    // Check database connectivity
    const sql = neon(process.env.DATABASE_URL!);
    await sql`SELECT 1`;
    checks.database = true;

    try {
      const syncRows = await sql`
        SELECT started_at, finished_at, status, error_count
        FROM sync_runs
        WHERE provider = 'notion'
        ORDER BY started_at DESC
        LIMIT 1
      `;
      details.lastSyncRun = syncRows[0] || null;
      const last = syncRows[0] as { status?: string; error_count?: string } | undefined;
      checks.sync = !last || (last.status === "success" && parseInt(last.error_count || "0", 10) === 0);
    } catch {
      details.lastSyncRun = null;
      // Table may not exist yet; do not fail health for that.
      checks.sync = true;
    }

    const queueRows = await sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'processing') as processing,
        COUNT(*) FILTER (WHERE status = 'failed') as failed
      FROM enrichment_queue
    `;
    const queue = queueRows[0] as { pending: string; processing: string; failed: string };
    details.enrichmentQueue = {
      pending: parseInt(queue.pending || "0", 10),
      processing: parseInt(queue.processing || "0", 10),
      failed: parseInt(queue.failed || "0", 10),
    };
    checks.enrichmentQueue = parseInt(queue.failed || "0", 10) < 25;
  } catch (error) {
    console.error("[HEALTH] Database check failed:", error);
  }

  const allHealthy = Object.values(checks).every(Boolean);

  return NextResponse.json(
    {
      status: allHealthy ? "healthy" : "degraded",
      checks,
      details,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || "1.0.0",
    },
    { status: allHealthy ? 200 : 503 }
  );
}
