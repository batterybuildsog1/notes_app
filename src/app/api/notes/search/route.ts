/**
 * Hybrid Search API - Combines keyword (tsvector) + semantic (pgvector) search
 * with Reciprocal Rank Fusion for best-of-both-worlds relevance.
 *
 * POST /api/notes/search
 * Body: { query: string, limit?: number, category?: string, noteType?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth";
import { checkServiceAuth } from "@/lib/service-auth";
import { generateEmbedding } from "@/lib/enrichment";
import { hybridSearch } from "@/lib/db";

export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const { query, limit = 15, category, noteType } = body;

    if (!query || typeof query !== "string") {
      return NextResponse.json(
        { error: "Query is required" },
        { status: 400 }
      );
    }

    // Generate embedding for the query
    const queryEmbedding = await generateEmbedding(query);
    if (!queryEmbedding) {
      return NextResponse.json(
        { error: "Failed to generate query embedding" },
        { status: 500 }
      );
    }

    const results = await hybridSearch(userId, query, queryEmbedding, {
      limit,
      category,
      noteType,
    });

    return NextResponse.json({
      query,
      resultCount: results.length,
      results: results.map((row) => ({
        id: row.id,
        title: row.title,
        content: row.content?.slice(0, 300),
        category: row.category,
        tags: row.tags,
        note_type: row.note_type,
        score: parseFloat(row.score?.toString() || "0"),
        matchType: row.matchType,
        created_at: row.created_at,
        updated_at: row.updated_at,
      })),
    });
  } catch (error) {
    console.error("[HYBRID-SEARCH] Error:", error);
    return NextResponse.json(
      { error: "Search failed" },
      { status: 500 }
    );
  }
}
