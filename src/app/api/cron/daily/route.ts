/**
 * Consolidated Daily Cron Job
 *
 * Runs once daily and handles:
 * 1. Notion sync (bidirectional)
 * 2. Basic enrichment (tags, project extraction)
 * 3. AI batch enrichment (summaries, action items, relationships)
 *
 * Schedule: 7 AM UTC daily
 */

import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { enrichWithEntities, linkEntitiesToNote } from "@/lib/entity-extraction";
import { generateEmbedding } from "@/lib/enrichment";
import {
  claimEnrichmentBatch,
  completeQueueItems,
  failQueueItem,
  resetStaleQueueItems,
  getQueueStats,
  updateNoteEmbedding,
  findOrCreatePerson,
  findOrCreateCompany,
  findOrCreateProject,
  linkPersonToNote,
  linkCompanyToNote,
  linkProjectToNote,
} from "@/lib/db";
import {
  batchExtractEnrichments,
  batchGenerateEmbeddings,
  entitiesToTags,
  handleAmbiguities,
} from "@/lib/batch-enrichment";
import { sendTelegramMessage, isTelegramConfigured } from "@/lib/telegram";

export const runtime = "edge";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes max

const sql = neon(process.env.DATABASE_URL!);
const DEFAULT_USER_ID = "3d866169-c8db-4d46-beef-dd6fc4daa930";

interface TaskResult {
  name: string;
  success: boolean;
  duration: number;
  details: Record<string, unknown>;
  error?: string;
}

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();
  const results: TaskResult[] = [];

  // Task 1: Notion Sync
  const syncResult = await runNotionSync(request.url);
  results.push(syncResult);

  // Task 2: Basic Enrichment (tags, project)
  const basicResult = await runBasicEnrichment();
  results.push(basicResult);

  // Task 3: AI Batch Enrichment (summaries, actions, relationships)
  const batchResult = await runBatchEnrichment();
  results.push(batchResult);

  const totalDuration = Date.now() - startTime;
  const allSuccessful = results.every((r) => r.success);

  // Send summary to Telegram
  if (isTelegramConfigured()) {
    const summary = results
      .map((r) => `${r.success ? "+" : "x"} ${r.name}: ${r.duration}ms`)
      .join("\n");

    await sendTelegramMessage(
      `Daily cron ${allSuccessful ? "completed" : "had errors"}\n\n${summary}`,
      { parseMode: "Markdown" }
    ).catch(() => {});
  }

  console.log(`[DAILY CRON] Completed in ${totalDuration}ms`);

  return NextResponse.json({
    ok: allSuccessful,
    timestamp: new Date().toISOString(),
    duration: `${totalDuration}ms`,
    tasks: results,
  });
}

async function runNotionSync(baseUrl: string): Promise<TaskResult> {
  const start = Date.now();
  try {
    const syncUrl = new URL("/api/sync/notion", baseUrl);
    const response = await fetch(syncUrl.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": process.env.SERVICE_API_KEY || "",
      },
      body: JSON.stringify({ direction: "both" }),
    });

    const result = await response.json();
    console.log("[DAILY CRON] Notion sync:", JSON.stringify(result));

    return {
      name: "Notion Sync",
      success: response.ok,
      duration: Date.now() - start,
      details: result,
    };
  } catch (error) {
    return {
      name: "Notion Sync",
      success: false,
      duration: Date.now() - start,
      details: {},
      error: error instanceof Error ? error.message : "Unknown",
    };
  }
}

async function runBasicEnrichment(): Promise<TaskResult> {
  const start = Date.now();
  const details = {
    processed: 0,
    enriched: 0,
    titled: 0,
    linked: { people: 0, companies: 0, projects: 0 },
    errors: [] as string[],
  };

  try {
    // Get unenriched notes
    const notes = await sql`
      SELECT id, title, content, tags, project, user_id
      FROM notes
      WHERE user_id = ${DEFAULT_USER_ID}
        AND enriched_at IS NULL
      ORDER BY created_at DESC
      LIMIT 50
    `;

    console.log(`[DAILY CRON] Basic enrichment: ${notes.length} notes`);

    for (const note of notes) {
      try {
        const n = note as { id: string; title: string; content: string; tags: string[] | null; project: string | null; user_id: string };

        const enrichment = await enrichWithEntities(n.title, n.content, n.tags || []);

        const updates: { tags?: string[]; project?: string; title?: string } = {};

        if (enrichment.tags.length > (n.tags?.length || 0)) {
          updates.tags = enrichment.tags;
        }
        if (enrichment.project && !n.project) {
          updates.project = enrichment.project;
        }
        if (enrichment.newTitle && (!n.title || n.title.toLowerCase() === "untitled")) {
          updates.title = enrichment.newTitle;
          details.titled++;
        }

        // Link entities
        if (enrichment.entities) {
          try {
            const linked = await linkEntitiesToNote(n.id, n.user_id, enrichment.entities);
            details.linked.people += linked.people.length;
            details.linked.companies += linked.companies.length;
            details.linked.projects += linked.projects.length;
          } catch { /* ignore */ }
        }

        // Apply updates
        if (Object.keys(updates).length > 0) {
          await sql`
            UPDATE notes SET
              tags = COALESCE(${updates.tags || null}::text[], tags),
              project = COALESCE(${updates.project || null}, project),
              title = COALESCE(${updates.title || null}, title),
              enriched_at = NOW(),
              updated_at = NOW()
            WHERE id = ${n.id}
          `;
          details.enriched++;
        } else {
          await sql`UPDATE notes SET enriched_at = NOW() WHERE id = ${n.id}`;
        }

        details.processed++;
      } catch (error) {
        details.errors.push(`${(note as { id: string }).id}: ${error instanceof Error ? error.message : "Unknown"}`);
      }
    }

    return {
      name: "Basic Enrichment",
      success: true,
      duration: Date.now() - start,
      details,
    };
  } catch (error) {
    return {
      name: "Basic Enrichment",
      success: false,
      duration: Date.now() - start,
      details,
      error: error instanceof Error ? error.message : "Unknown",
    };
  }
}

async function runBatchEnrichment(): Promise<TaskResult> {
  const start = Date.now();
  const details = {
    processed: 0,
    summaries: 0,
    actionItems: 0,
    relationships: 0,
    clarifications: 0,
    embedded: 0,
    staleReset: 0,
    errors: [] as string[],
  };

  try {
    // Reset stale items
    details.staleReset = await resetStaleQueueItems();

    // Claim batch
    const batch = await claimEnrichmentBatch(8);
    if (batch.length === 0) {
      const stats = await getQueueStats();
      return {
        name: "AI Batch Enrichment",
        success: true,
        duration: Date.now() - start,
        details: { message: "No notes in queue", queueStats: stats },
      };
    }

    console.log(`[DAILY CRON] Batch enrichment: ${batch.length} notes`);
    const userId = batch[0].userId;

    // Prepare input
    const batchInput = batch.map((item) => ({
      id: item.noteId,
      title: item.title,
      content: item.content,
      userId: item.userId,
    }));

    // Enrich and embed in parallel
    const [enrichments, embeddings] = await Promise.all([
      batchExtractEnrichments(batchInput),
      batchGenerateEmbeddings(batchInput),
    ]);

    const completedQueueIds: string[] = [];

    for (const item of batch) {
      try {
        const enrichment = enrichments.get(item.noteId);
        const embedding = embeddings.get(item.noteId);

        if (!enrichment) {
          await failQueueItem(item.queueId, "No enrichment");
          details.errors.push(`${item.noteId}: No enrichment`);
          continue;
        }

        // Update note with summary
        await sql`
          UPDATE notes SET
            ai_summary = ${JSON.stringify(enrichment.summary)},
            summary_generated_at = NOW(),
            tags = COALESCE(${entitiesToTags(enrichment.entities)}::text[], tags),
            project = COALESCE(${enrichment.entities.projects?.[0] || enrichment.intent.extracted?.project || null}, project),
            enriched_at = NOW(),
            updated_at = NOW()
          WHERE id = ${item.noteId}
        `;
        details.summaries++;

        // Create action items
        for (const action of enrichment.actionItems) {
          if (!action.certain && action.source !== "explicit_request") continue;

          let personId = null;
          if (action.assignee && action.assignee !== "user") {
            try {
              const person = await findOrCreatePerson(userId, action.assignee);
              personId = person.id;
            } catch { /* ignore */ }
          }

          await sql`
            INSERT INTO action_items (
              note_id, user_id, text, assignee_type, assignee_name, assignee_person_id,
              priority, source, due_date, temporal_context
            ) VALUES (
              ${item.noteId}, ${userId}, ${action.text},
              ${action.assignee === "user" ? "user" : action.assignee ? "person" : "unknown"},
              ${action.assignee || null}, ${personId},
              ${action.priority}, ${action.source},
              ${action.dueDate ? new Date(action.dueDate).toISOString() : null},
              ${action.dueDateDescription || null}
            ) ON CONFLICT DO NOTHING
          `;
          details.actionItems++;
        }

        // Store relationships
        for (const rel of enrichment.relationships) {
          if (!rel.certain) continue;

          try {
            let sourceId: string | null = null;
            let targetId: string | null = null;

            if (rel.sourceType === "person") {
              const p = await findOrCreatePerson(userId, rel.source);
              sourceId = p.id;
              await linkPersonToNote(item.noteId, p.id);
            } else if (rel.sourceType === "company") {
              const c = await findOrCreateCompany(userId, rel.source);
              sourceId = c.id;
              await linkCompanyToNote(item.noteId, c.id);
            } else if (rel.sourceType === "project") {
              const p = await findOrCreateProject(userId, rel.source);
              sourceId = p.id;
              await linkProjectToNote(item.noteId, p.id);
            }

            if (rel.targetType === "person") {
              const p = await findOrCreatePerson(userId, rel.target);
              targetId = p.id;
            } else if (rel.targetType === "company") {
              const c = await findOrCreateCompany(userId, rel.target);
              targetId = c.id;
            } else if (rel.targetType === "project") {
              const p = await findOrCreateProject(userId, rel.target);
              targetId = p.id;
            }

            if (sourceId && targetId) {
              await sql`
                INSERT INTO entity_relationships (
                  user_id, source_type, source_id, target_type, target_id,
                  relationship_type, context, note_id
                ) VALUES (
                  ${userId}, ${rel.sourceType}, ${sourceId}, ${rel.targetType}, ${targetId},
                  ${rel.relationship}, ${rel.context}, ${item.noteId}
                )
                ON CONFLICT (user_id, source_type, source_id, target_type, target_id, relationship_type)
                DO UPDATE SET confirmation_count = entity_relationships.confirmation_count + 1,
                  last_confirmed_at = NOW(), context = EXCLUDED.context
              `;
              details.relationships++;
            }
          } catch { /* ignore */ }
        }

        // Handle ambiguities
        if (enrichment.ambiguities.length > 0) {
          await handleAmbiguities(item.noteId, item.title, enrichment.ambiguities, userId);
          details.clarifications += enrichment.ambiguities.length;
        }

        // Store embedding
        if (embedding) {
          await updateNoteEmbedding(item.noteId, embedding);
          details.embedded++;
        }

        details.processed++;
        completedQueueIds.push(item.queueId);
      } catch (error) {
        details.errors.push(`${item.noteId}: ${error instanceof Error ? error.message : "Unknown"}`);
        await failQueueItem(item.queueId, error instanceof Error ? error.message : "Unknown");
      }
    }

    if (completedQueueIds.length > 0) {
      await completeQueueItems(completedQueueIds);
    }

    return {
      name: "AI Batch Enrichment",
      success: true,
      duration: Date.now() - start,
      details,
    };
  } catch (error) {
    return {
      name: "AI Batch Enrichment",
      success: false,
      duration: Date.now() - start,
      details,
      error: error instanceof Error ? error.message : "Unknown",
    };
  }
}
