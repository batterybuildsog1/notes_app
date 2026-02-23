/**
 * Issues API - Surface problems for PM monitoring
 *
 * GET /api/issues - Get all issues
 * Protected by service auth
 */

import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { checkServiceAuth } from "@/lib/service-auth";

const sql = neon(process.env.DATABASE_URL!);

interface Issue {
  type: string;
  severity: "low" | "medium" | "high" | "critical";
  count: number;
  description: string;
  sampleIds?: string[];
  details?: Record<string, unknown>;
}

interface IssuesReport {
  timestamp: string;
  totalIssues: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  issues: Issue[];
  summary: {
    totalNotes: number;
    notesWithoutCategory: number;
    notesWithoutTags: number;
    notesWithoutEmbeddings: number;
    notesPendingEnrichment: number;
    notesWithoutType: number;
    notesWithoutTitle: number;
    pendingClarifications: number;
  };
}

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // Verify service auth
  const serviceAuth = checkServiceAuth(request);
  if (!serviceAuth.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = serviceAuth.userId!;
  const issues: Issue[] = [];

  try {
    // 1. Get base stats
    const statsResult = await sql`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE category IS NULL) as no_category,
        COUNT(*) FILTER (WHERE tags IS NULL OR array_length(tags, 1) = 0) as no_tags,
        COUNT(*) FILTER (WHERE embedding IS NULL) as no_embedding,
        COUNT(*) FILTER (WHERE enriched_at IS NULL AND created_at < NOW() - INTERVAL '24 hours') as pending_enrichment,
        COUNT(*) FILTER (WHERE note_type IS NULL) as no_type,
        COUNT(*) FILTER (WHERE title IS NULL OR length(trim(title)) < 3 OR lower(trim(title)) = 'untitled') as no_title
      FROM notes
      WHERE user_id = ${userId}
    `;
    const stats = statsResult[0] as {
      total: string;
      no_category: string;
      no_tags: string;
      no_embedding: string;
      pending_enrichment: string;
      no_type: string;
      no_title: string;
    };

    const totalNotes = parseInt(stats.total);
    const notesWithoutCategory = parseInt(stats.no_category);
    const notesWithoutTags = parseInt(stats.no_tags);
    const notesWithoutEmbeddings = parseInt(stats.no_embedding);
    const notesPendingEnrichment = parseInt(stats.pending_enrichment);
    const notesWithoutType = parseInt(stats.no_type || '0');
    const notesWithoutTitle = parseInt(stats.no_title || '0');

    // 2. Notes without categories (medium priority if many)
    if (notesWithoutCategory > 0) {
      const sampleResult = await sql`
        SELECT id, title
        FROM notes
        WHERE user_id = ${userId} AND category IS NULL
        ORDER BY created_at DESC
        LIMIT 5
      `;
      issues.push({
        type: "notes_without_category",
        severity: notesWithoutCategory > 100 ? "high" : notesWithoutCategory > 50 ? "medium" : "low",
        count: notesWithoutCategory,
        description: `${notesWithoutCategory} notes lack categories (${Math.round((notesWithoutCategory / totalNotes) * 100)}% of total)`,
        sampleIds: (sampleResult as { id: string; title: string }[]).map(r => r.id),
      });
    }

    // 3. Notes without tags (high priority - hurts searchability)
    if (notesWithoutTags > 0) {
      const sampleResult = await sql`
        SELECT id, title
        FROM notes
        WHERE user_id = ${userId} AND (tags IS NULL OR array_length(tags, 1) = 0)
        ORDER BY created_at DESC
        LIMIT 5
      `;
      issues.push({
        type: "notes_without_tags",
        severity: notesWithoutTags > 200 ? "high" : notesWithoutTags > 100 ? "medium" : "low",
        count: notesWithoutTags,
        description: `${notesWithoutTags} notes lack tags (${Math.round((notesWithoutTags / totalNotes) * 100)}% of total) - impacts searchability`,
        sampleIds: (sampleResult as { id: string; title: string }[]).map(r => r.id),
      });
    }

    // 4. Notes without embeddings (can't do semantic search)
    if (notesWithoutEmbeddings > 0) {
      const sampleResult = await sql`
        SELECT id, title
        FROM notes
        WHERE user_id = ${userId} AND embedding IS NULL
        ORDER BY created_at DESC
        LIMIT 5
      `;
      issues.push({
        type: "notes_without_embeddings",
        severity: notesWithoutEmbeddings > 100 ? "high" : "medium",
        count: notesWithoutEmbeddings,
        description: `${notesWithoutEmbeddings} notes lack embeddings (${Math.round((notesWithoutEmbeddings / totalNotes) * 100)}% of total) - semantic search disabled`,
        sampleIds: (sampleResult as { id: string; title: string }[]).map(r => r.id),
      });
    }

    // 5a. Notes without note_type
    if (notesWithoutType > 0) {
      issues.push({
        type: "notes_without_type",
        severity: notesWithoutType > 200 ? "medium" : "low",
        count: notesWithoutType,
        description: `${notesWithoutType} notes lack a note type classification (${Math.round((notesWithoutType / totalNotes) * 100)}% of total)`,
      });
    }

    // 5b. Notes without proper titles
    if (notesWithoutTitle > 0) {
      issues.push({
        type: "notes_without_title",
        severity: notesWithoutTitle > 100 ? "medium" : "low",
        count: notesWithoutTitle,
        description: `${notesWithoutTitle} notes are untitled or have very short titles`,
      });
    }

    // 6. Notes stuck in enrichment (>24h, no enriched_at)
    if (notesPendingEnrichment > 0) {
      const sampleResult = await sql`
        SELECT id, title, created_at
        FROM notes
        WHERE user_id = ${userId} 
          AND enriched_at IS NULL 
          AND created_at < NOW() - INTERVAL '24 hours'
        ORDER BY created_at ASC
        LIMIT 5
      `;
      issues.push({
        type: "enrichment_stalled",
        severity: notesPendingEnrichment > 50 ? "critical" : notesPendingEnrichment > 20 ? "high" : "medium",
        count: notesPendingEnrichment,
        description: `${notesPendingEnrichment} notes created >24h ago still pending enrichment - Grok pipeline may be stuck`,
        sampleIds: (sampleResult as { id: string; title: string }[]).map(r => r.id),
        details: { 
          oldestNote: (sampleResult as { id: string; title: string; created_at: Date }[])[0]?.created_at 
        },
      });
    }

    // 6. Pending clarifications (stuck waiting for user input)
    const clarificationResult = await sql`
      SELECT COUNT(*) as count
      FROM clarifications
      WHERE user_id = ${userId} AND status = 'pending'
    `;
    const pendingClarifications = parseInt((clarificationResult[0] as { count: string }).count);

    if (pendingClarifications > 0) {
      const oldClarifications = await sql`
        SELECT c.id, c.note_id, c.question, c.created_at, n.title
        FROM clarifications c
        JOIN notes n ON c.note_id = n.id
        WHERE c.user_id = ${userId} 
          AND c.status = 'pending'
          AND c.created_at < NOW() - INTERVAL '48 hours'
        ORDER BY c.created_at ASC
        LIMIT 5
      `;
      
      issues.push({
        type: "pending_clarifications",
        severity: oldClarifications.length > 10 ? "high" : oldClarifications.length > 5 ? "medium" : "low",
        count: pendingClarifications,
        description: `${pendingClarifications} notes pending clarification${oldClarifications.length > 0 ? ` (${oldClarifications.length} >48h old)` : ''}`,
        sampleIds: (oldClarifications as { note_id: string; title: string }[]).map(r => r.note_id),
        details: {
          oldClarificationCount: oldClarifications.length,
          samples: (oldClarifications as { note_id: string; title: string; question: string }[]).map(r => ({
            noteId: r.note_id,
            title: r.title,
            question: r.question,
          })),
        },
      });
    }

    // 7. Check for recent API errors (high token usage with no results might indicate errors)
    const recentErrorsResult = await sql`
      SELECT COUNT(*) as count
      FROM token_usage
      WHERE user_id = ${userId}
        AND timestamp > NOW() - INTERVAL '24 hours'
        AND (
          -- Failed operations typically have very low output tokens
          (output_tokens < 10 AND input_tokens > 100)
          OR cost_usd = 0
        )
    `;
    const potentialErrors = parseInt((recentErrorsResult[0] as { count: string }).count);

    if (potentialErrors > 10) {
      issues.push({
        type: "potential_api_errors",
        severity: potentialErrors > 50 ? "critical" : potentialErrors > 20 ? "high" : "medium",
        count: potentialErrors,
        description: `${potentialErrors} API calls in last 24h with suspicious patterns (high input, low/no output) - possible Grok/OpenAI failures`,
      });
    }

    // 8. Duplicate entities check (suggestion)
    const duplicatePeopleResult = await sql`
      SELECT normalized_name, COUNT(*) as count
      FROM people
      WHERE user_id = ${userId}
      GROUP BY normalized_name
      HAVING COUNT(*) > 1
      LIMIT 10
    `;
    const duplicatePeople = duplicatePeopleResult as { normalized_name: string; count: string }[];

    if (duplicatePeople.length > 0) {
      issues.push({
        type: "duplicate_entities",
        severity: "low",
        count: duplicatePeople.length,
        description: `${duplicatePeople.length} duplicate person entities detected (e.g., "${duplicatePeople[0]?.normalized_name}" appears ${duplicatePeople[0]?.count} times)`,
        details: { duplicates: duplicatePeople.map(p => ({ name: p.normalized_name, count: parseInt(p.count) })) },
      });
    }

    // Sort issues by severity
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    const report: IssuesReport = {
      timestamp: new Date().toISOString(),
      totalIssues: issues.length,
      criticalCount: issues.filter(i => i.severity === "critical").length,
      highCount: issues.filter(i => i.severity === "high").length,
      mediumCount: issues.filter(i => i.severity === "medium").length,
      lowCount: issues.filter(i => i.severity === "low").length,
      issues,
      summary: {
        totalNotes,
        notesWithoutCategory,
        notesWithoutTags,
        notesWithoutEmbeddings,
        notesPendingEnrichment,
        notesWithoutType,
        notesWithoutTitle,
        pendingClarifications,
      },
    };

    return NextResponse.json(report);

  } catch (error) {
    console.error("[ISSUES API] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch issues", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
