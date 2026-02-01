import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { getAuthUserId } from "@/lib/auth";
import { checkServiceAuth } from "@/lib/service-auth";
import { generateEmbedding } from "@/lib/enrichment";

/**
 * Semantic search endpoint
 * POST /api/notes/semantic-search
 * 
 * Body: { query: string, limit?: number }
 * Returns notes ranked by semantic similarity
 */
export async function POST(request: NextRequest) {
  try {
    // Check user auth first, then service auth
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
    const { query, limit = 10 } = body;

    if (!query || typeof query !== "string") {
      return NextResponse.json(
        { error: "Query is required" },
        { status: 400 }
      );
    }

    // Generate embedding for query
    const queryEmbedding = await generateEmbedding(query);
    if (!queryEmbedding) {
      return NextResponse.json(
        { error: "Failed to generate query embedding" },
        { status: 500 }
      );
    }

    const sql = neon(process.env.DATABASE_URL!);

    // Use pgvector cosine similarity for semantic search
    // Notes without embeddings are excluded
    const embeddingStr = `[${queryEmbedding.join(",")}]`;
    
    const results = await sql`
      SELECT 
        id, title, content, category, tags, priority, project,
        created_at, updated_at,
        1 - (embedding <=> ${embeddingStr}::vector) as similarity
      FROM notes
      WHERE user_id = ${userId}
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${embeddingStr}::vector
      LIMIT ${limit}
    `;

    return NextResponse.json({
      query,
      results: results.map((row) => ({
        ...row,
        similarity: parseFloat(row.similarity?.toString() || "0"),
      })),
    });
  } catch (error) {
    console.error("[SEMANTIC-SEARCH] Error:", error);
    return NextResponse.json(
      { error: "Search failed" },
      { status: 500 }
    );
  }
}
