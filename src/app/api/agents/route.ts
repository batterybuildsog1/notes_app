import { NextResponse } from "next/server";
import { AGENTS, AGENT_GROUPS } from "@/lib/agents";

/**
 * GET /api/agents
 * Returns the full agent registry. Public endpoint (no auth required).
 * Swarm and other systems can query this instead of maintaining their own lists.
 */
export async function GET() {
  return NextResponse.json({
    agents: AGENTS,
    groups: AGENT_GROUPS,
  });
}
