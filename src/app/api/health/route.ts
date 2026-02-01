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
  };

  try {
    // Check database connectivity
    const sql = neon(process.env.DATABASE_URL!);
    await sql`SELECT 1`;
    checks.database = true;
  } catch (error) {
    console.error("[HEALTH] Database check failed:", error);
  }

  const allHealthy = Object.values(checks).every(Boolean);

  return NextResponse.json(
    {
      status: allHealthy ? "healthy" : "degraded",
      checks,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || "1.0.0",
    },
    { status: allHealthy ? 200 : 503 }
  );
}
