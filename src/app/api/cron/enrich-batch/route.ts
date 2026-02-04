/**
 * Enhanced Cron - Relationships, Summaries, Action Items
 *
 * Key behaviors:
 * - When certain: Store data directly
 * - When uncertain: Send Telegram clarification
 * - Build knowledge graph over time
 * - Connect related notes automatically
 */

import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
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

export const runtime = "edge";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const sql = neon(process.env.DATABASE_URL!);
const BATCH_SIZE = 8; // Reduced for richer processing per note

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();
  const results = {
    processed: 0,
    summaries: 0,
    actionItems: 0,
    relationships: 0,
    clarifications: 0,
    linksSuggested: 0,
    embedded: 0,
    errors: [] as string[],
    staleReset: 0,
  };

  try {
    // Reset stale items
    results.staleReset = await resetStaleQueueItems();
    if (results.staleReset > 0) {
      console.log(`[ENRICH] Reset ${results.staleReset} stale items`);
    }

    // Claim batch
    const batch = await claimEnrichmentBatch(BATCH_SIZE);
    if (batch.length === 0) {
      const stats = await getQueueStats();
      return NextResponse.json({ ok: true, message: "No notes", queueStats: stats });
    }

    console.log(`[ENRICH] Processing ${batch.length} notes with context`);
    const userId = batch[0].userId;

    // Prepare input
    const batchInput = batch.map(item => ({
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
          results.errors.push(`${item.noteId}: No enrichment`);
          continue;
        }

        // 1. Update note with summary
        await sql`
          UPDATE notes
          SET
            ai_summary = ${JSON.stringify(enrichment.summary)},
            summary_generated_at = NOW(),
            tags = COALESCE(${entitiesToTags(enrichment.entities)}::text[], tags),
            project = COALESCE(${
              enrichment.entities.projects?.[0] || enrichment.intent.extracted?.project || null
            }, project),
            enriched_at = NOW(),
            updated_at = NOW()
          WHERE id = ${item.noteId}
        `;
        results.summaries++;

        // 2. Create action items (only certain ones)
        for (const action of enrichment.actionItems) {
          if (!action.certain && action.source !== 'explicit_request') continue;

          let personId = null;
          if (action.assignee && action.assignee !== 'user') {
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
              ${action.assignee === 'user' ? 'user' : action.assignee ? 'person' : 'unknown'},
              ${action.assignee || null}, ${personId},
              ${action.priority}, ${action.source},
              ${action.dueDate ? new Date(action.dueDate).toISOString() : null},
              ${action.dueDateDescription || null}
            )
            ON CONFLICT DO NOTHING
          `;
          results.actionItems++;
        }

        // 3. Store relationships (only certain ones)
        for (const rel of enrichment.relationships) {
          if (!rel.certain) continue;

          try {
            // Resolve entities
            let sourceId: string | null = null;
            let targetId: string | null = null;

            if (rel.sourceType === 'person') {
              const p = await findOrCreatePerson(userId, rel.source);
              sourceId = p.id;
              await linkPersonToNote(item.noteId, p.id);
            } else if (rel.sourceType === 'company') {
              const c = await findOrCreateCompany(userId, rel.source);
              sourceId = c.id;
              await linkCompanyToNote(item.noteId, c.id);
            } else if (rel.sourceType === 'project') {
              const p = await findOrCreateProject(userId, rel.source);
              sourceId = p.id;
              await linkProjectToNote(item.noteId, p.id);
            }

            if (rel.targetType === 'person') {
              const p = await findOrCreatePerson(userId, rel.target);
              targetId = p.id;
            } else if (rel.targetType === 'company') {
              const c = await findOrCreateCompany(userId, rel.target);
              targetId = c.id;
            } else if (rel.targetType === 'project') {
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
                DO UPDATE SET
                  confirmation_count = entity_relationships.confirmation_count + 1,
                  last_confirmed_at = NOW(),
                  context = EXCLUDED.context
              `;
              results.relationships++;
            }
          } catch (err) {
            console.warn(`[ENRICH] Relationship failed:`, err);
          }
        }

        // 4. Store temporal references
        for (const temp of enrichment.temporalReferences) {
          await sql`
            INSERT INTO temporal_references (
              note_id, user_id, reference_text, reference_type,
              normalized_date, normalized_description, is_deadline, context
            ) VALUES (
              ${item.noteId}, ${userId}, ${temp.text}, ${temp.type},
              ${temp.normalizedDate}, ${temp.description}, ${temp.isDeadline}, ${''}
            )
          `;
        }

        // 5. Handle ambiguities via Telegram
        if (enrichment.ambiguities.length > 0) {
          await handleAmbiguities(item.noteId, item.title, enrichment.ambiguities, userId);
          results.clarifications += enrichment.ambiguities.length;
        }

        // 6. Store note intent
        await sql`
          INSERT INTO note_intents (note_id, user_id, intent, extracted_data)
          VALUES (${item.noteId}, ${userId}, ${enrichment.intent.type}, ${JSON.stringify(enrichment.intent.extracted)})
          ON CONFLICT (note_id) DO UPDATE SET
            intent = EXCLUDED.intent,
            extracted_data = EXCLUDED.extracted_data
        `;

        // 7. Suggest note connections
        for (const conn of enrichment.suggestedConnections) {
          try {
            await sql`
              INSERT INTO suggested_note_links (
                source_note_id, target_note_id, user_id, link_type, reason
              ) VALUES (
                ${item.noteId}, ${conn.noteId}, ${userId}, 'ai_suggested', ${conn.reason}
              )
              ON CONFLICT DO NOTHING
            `;
            results.linksSuggested++;
          } catch { /* ignore duplicates */ }
        }

        // 8. Store embedding
        if (embedding) {
          await updateNoteEmbedding(item.noteId, embedding);
          results.embedded++;
        }

        results.processed++;
        completedQueueIds.push(item.queueId);
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown";
        results.errors.push(`${item.noteId}: ${msg}`);
        await failQueueItem(item.queueId, msg);
      }
    }

    if (completedQueueIds.length > 0) {
      await completeQueueItems(completedQueueIds);
    }

    const duration = Date.now() - startTime;
    const stats = await getQueueStats();

    console.log(
      `[ENRICH] Done: ${results.processed} notes, ${results.summaries} summaries, ` +
      `${results.actionItems} actions, ${results.relationships} relations, ${duration}ms`
    );

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      duration: `${duration}ms`,
      ...results,
      queueStats: stats,
    });

  } catch (error) {
    console.error("[ENRICH] Error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown" },
      { status: 500 }
    );
  }
}
