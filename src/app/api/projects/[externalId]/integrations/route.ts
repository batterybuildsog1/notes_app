import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth";
import { checkServiceAuth } from "@/lib/service-auth";

const SWARM_API_BASE = process.env.SWARM_API_BASE || "http://localhost:4180";
const SWARM_API_TOKEN = process.env.SWARM_API_TOKEN || "";

// Simple in-memory cache (5-min TTL)
const cache = new Map<string, { data: unknown; expires: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

async function getUserId(request: NextRequest): Promise<string | null> {
  const userId = await getAuthUserId();
  if (userId) return userId;
  const serviceAuth = checkServiceAuth(request);
  if (serviceAuth.authenticated) return serviceAuth.userId;
  return null;
}

/**
 * GET /api/projects/:externalId/integrations
 * Proxy to swarm's integration events for a project.
 * Returns Gmail threads, GCal events, GDrive files.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ externalId: string }> }
) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { externalId } = await params;
  if (!externalId) return NextResponse.json({ error: "externalId required" }, { status: 400 });

  // Check cache
  const cacheKey = `integrations:${externalId}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return NextResponse.json(cached.data);
  }

  try {
    const res = await fetch(
      `${SWARM_API_BASE}/api/integrations/events?projectId=${encodeURIComponent(externalId)}`,
      {
        headers: {
          Authorization: `Bearer ${SWARM_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(15000),
      }
    );

    if (!res.ok) {
      return NextResponse.json(
        { error: `Swarm API returned ${res.status}`, events: [] },
        { status: 502 }
      );
    }

    const data = await res.json();
    cache.set(cacheKey, { data, expires: Date.now() + CACHE_TTL_MS });
    return NextResponse.json(data);
  } catch (err) {
    console.error(`[PROXY] Failed to fetch integrations for ${externalId}:`, err);
    return NextResponse.json(
      { error: "Failed to reach swarm backend", events: [] },
      { status: 502 }
    );
  }
}
