/**
 * Notion Sync API
 * POST /api/sync/notion - Trigger bidirectional sync
 * GET /api/sync/notion - Check sync status
 */

import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { validateServiceAuth, getServiceUserId } from "@/lib/service-auth";
import {
  searchNotionPages,
  getPageBlocks,
  blocksToMarkdown,
  getPageTitle,
  createNotionPage,
  checkNotionConnection,
} from "@/lib/notion-sync";
import { generateEmbedding } from "@/lib/enrichment";
import { enrichWithEntities } from "@/lib/entity-extraction";

const sql = neon(process.env.DATABASE_URL!);

interface SyncState {
  user_id: string;
  last_pull_at: Date | null;
  last_push_at: Date | null;
}

interface Note {
  id: number;
  title: string;
  content: string;
  category: string | null;
  tags: string[] | null;
  notion_page_id: string | null;
  notion_last_edited: Date | null;
  created_at: Date;
  updated_at: Date;
  original_created_at: Date | null;
  original_updated_at: Date | null;
}

async function startSyncRun(userId: string, direction: string): Promise<string | null> {
  try {
    const rows = await sql`
      INSERT INTO sync_runs (user_id, provider, direction, status)
      VALUES (${userId}, 'notion', ${direction}, 'running')
      RETURNING id
    `;
    return (rows[0] as { id: string }).id;
  } catch {
    // sync_runs may not exist yet in some environments; don't block sync.
    return null;
  }
}

async function finishSyncRun(
  runId: string | null,
  payload: {
    status: "success" | "error";
    durationMs: number;
    pulled: number;
    pushed: number;
    errors: string[];
  }
): Promise<void> {
  if (!runId) return;

  try {
    await sql`
      UPDATE sync_runs
      SET status = ${payload.status},
          finished_at = NOW(),
          duration_ms = ${payload.durationMs},
          pulled_count = ${payload.pulled},
          pushed_count = ${payload.pushed},
          error_count = ${payload.errors.length},
          error_sample = ${JSON.stringify(payload.errors.slice(0, 5))}::jsonb
      WHERE id = ${runId}
    `;
  } catch {
    // Non-fatal
  }
}

/**
 * GET - Check sync status and Notion connection
 */
export async function GET(request: NextRequest) {
  // Validate service auth
  if (!validateServiceAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = getServiceUserId();

  try {
    // Check Notion connection
    const notionStatus = await checkNotionConnection();

    // Get sync state
    const stateRows = await sql`
      SELECT * FROM notion_sync_state WHERE user_id = ${userId}
    `;
    const state = stateRows[0] as SyncState | undefined;

    // Count linked notes
    const linkedResult = await sql`
      SELECT COUNT(*) as count FROM notes 
      WHERE user_id = ${userId} AND notion_page_id IS NOT NULL
    `;
    const linkedCount = parseInt((linkedResult[0] as { count: string }).count);

    // Count unlinked notes (created in app, not synced to Notion)
    const unlinkedResult = await sql`
      SELECT COUNT(*) as count FROM notes 
      WHERE user_id = ${userId} AND notion_page_id IS NULL
    `;
    const unlinkedCount = parseInt((unlinkedResult[0] as { count: string }).count);

    let lastRun: Record<string, unknown> | null = null;
    try {
      const runRows = await sql`
        SELECT id, direction, status, started_at, finished_at, duration_ms,
               pulled_count, pushed_count, error_count, error_sample
        FROM sync_runs
        WHERE user_id = ${userId} AND provider = 'notion'
        ORDER BY started_at DESC
        LIMIT 1
      `;
      lastRun = (runRows[0] as Record<string, unknown>) || null;
    } catch {
      // sync_runs may not exist yet.
    }

    return NextResponse.json({
      notion: notionStatus,
      sync: {
        lastPullAt: state?.last_pull_at || null,
        lastPushAt: state?.last_push_at || null,
        linkedNotes: linkedCount,
        unlinkedNotes: unlinkedCount,
        lastRun,
      },
    });
  } catch (error) {
    console.error("Sync status error:", error);
    return NextResponse.json(
      { error: "Failed to get sync status" },
      { status: 500 }
    );
  }
}

/**
 * POST - Trigger sync
 * Body: { direction?: "pull" | "push" | "both" }
 */
export async function POST(request: NextRequest) {
  // Validate service auth
  if (!validateServiceAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = getServiceUserId();
  const body = await request.json().catch(() => ({}));
  const direction = body.direction || "both";
  const runStart = Date.now();
  const runId = await startSyncRun(userId, direction);

  const result = {
    pulled: 0,
    pushed: 0,
    errors: [] as string[],
    details: {
      newFromNotion: [] as string[],
      updatedFromNotion: [] as string[],
      pushedToNotion: [] as string[],
    },
  };

  try {
    // Get current sync state
    const stateRows = await sql`
      SELECT * FROM notion_sync_state WHERE user_id = ${userId}
    `;
    let state = stateRows[0] as SyncState | undefined;

    // Create state if doesn't exist
    if (!state) {
      await sql`
        INSERT INTO notion_sync_state (user_id) VALUES (${userId})
      `;
      state = { user_id: userId, last_pull_at: null, last_push_at: null };
    }

    // PULL: Notion → Notes App
    if (direction === "pull" || direction === "both") {
      try {
        const pullResult = await pullFromNotion(userId, state.last_pull_at);
        result.pulled = pullResult.count;
        result.details.newFromNotion = pullResult.created;
        result.details.updatedFromNotion = pullResult.updated;
        result.errors.push(...pullResult.errors);

        // Update last pull timestamp
        await sql`
          UPDATE notion_sync_state 
          SET last_pull_at = NOW(), updated_at = NOW()
          WHERE user_id = ${userId}
        `;
      } catch (error) {
        result.errors.push(`Pull error: ${error instanceof Error ? error.message : "Unknown"}`);
      }
    }

    // PUSH: Notes App → Notion
    if (direction === "push" || direction === "both") {
      try {
        const pushResult = await pushToNotion(userId);
        result.pushed = pushResult.count;
        result.details.pushedToNotion = pushResult.pushed;
        result.errors.push(...pushResult.errors);

        // Update last push timestamp
        await sql`
          UPDATE notion_sync_state 
          SET last_push_at = NOW(), updated_at = NOW()
          WHERE user_id = ${userId}
        `;
      } catch (error) {
        result.errors.push(`Push error: ${error instanceof Error ? error.message : "Unknown"}`);
      }
    }

    const durationMs = Date.now() - runStart;
    await finishSyncRun(runId, {
      status: result.errors.length === 0 ? "success" : "error",
      durationMs,
      pulled: result.pulled,
      pushed: result.pushed,
      errors: result.errors,
    });

    return NextResponse.json({
      ok: result.errors.length === 0,
      durationMs,
      ...result,
    });
  } catch (error) {
    console.error("Sync error:", error);
    const durationMs = Date.now() - runStart;
    await finishSyncRun(runId, {
      status: "error",
      durationMs,
      pulled: result.pulled,
      pushed: result.pushed,
      errors: [error instanceof Error ? error.message : "Unknown"],
    });

    return NextResponse.json(
      { error: "Sync failed", details: error instanceof Error ? error.message : "Unknown" },
      { status: 500 }
    );
  }
}

/**
 * Pull pages from Notion and create/update notes
 */
async function pullFromNotion(
  userId: string,
  lastPullAt: Date | null
): Promise<{
  count: number;
  created: string[];
  updated: string[];
  errors: string[];
}> {
  const created: string[] = [];
  const updated: string[] = [];
  const errors: string[] = [];

  let cursor: string | undefined;
  let processedCount = 0;
  const maxPages = 100; // Limit per sync to avoid timeouts

  do {
    const searchResult = await searchNotionPages(lastPullAt ?? undefined, cursor);

    for (const page of searchResult.results) {
      if (processedCount >= maxPages) break;

      try {
        // Skip archived pages
        if (page.archived) continue;

        const pageEditedAt = new Date(page.last_edited_time);

        // Skip if not modified since last pull
        if (lastPullAt && pageEditedAt <= lastPullAt) {
          continue;
        }

        // Check if we already have this page
        const existingRows = await sql`
          SELECT * FROM notes 
          WHERE user_id = ${userId} AND notion_page_id = ${page.id}
        `;
        const existing = existingRows[0] as Note | undefined;

        // Get page content
        const blocks = await getPageBlocks(page.id);
        const content = blocksToMarkdown(blocks);
        const title = getPageTitle(page);

        if (existing) {
          // Update existing note only when Notion has moved forward since our last synced Notion edit.
          // Do NOT compare against notes.updated_at because local enrichment/tag edits also bump that field.
          const lastSyncedNotionEdit = existing.notion_last_edited
            ? new Date(existing.notion_last_edited)
            : null;

          if (!lastSyncedNotionEdit || pageEditedAt > lastSyncedNotionEdit) {
            // Preserve original_created_at, only update original_updated_at
            await sql`
              UPDATE notes
              SET title = ${title},
                  content = ${content},
                  notion_last_edited = ${page.last_edited_time},
                  original_updated_at = ${page.last_edited_time},
                  updated_at = NOW()
              WHERE id = ${existing.id}
            `;
            updated.push(title);

            // Run entity extraction + embedding in parallel
            try {
              const [enrichment, embedding] = await Promise.all([
                enrichWithEntities(title, content, existing.tags || []),
                generateEmbedding(`${title}\n\n${content}`),
              ]);

              // Apply entity enrichment
              if (enrichment.tags.length > 0 || enrichment.project) {
                await sql`
                  UPDATE notes
                  SET tags = ${enrichment.tags},
                      project = COALESCE(${enrichment.project}, project),
                      enriched_at = NOW()
                  WHERE id = ${existing.id}
                `;
              }

              // Apply embedding
              if (embedding) {
                const embeddingStr = `[${embedding.join(",")}]`;
                await sql`
                  UPDATE notes SET embedding = ${embeddingStr}::vector, indexed_at = NOW()
                  WHERE id = ${existing.id}
                `;
              }
            } catch {
              // Non-fatal
            }
          }
        } else {
          // Create new note - use Notion's timestamps for original_created_at/original_updated_at
          const rows = await sql`
            INSERT INTO notes (
              title, content, user_id, notion_page_id, notion_last_edited,
              created_at, updated_at, original_created_at, original_updated_at
            )
            VALUES (
              ${title}, ${content}, ${userId}, ${page.id}, ${page.last_edited_time},
              NOW(), NOW(), ${page.created_time}, ${page.last_edited_time}
            )
            RETURNING id
          `;
          const noteId = (rows[0] as { id: number }).id;
          created.push(title);

          // Run entity extraction + embedding in parallel
          try {
            const [enrichment, embedding] = await Promise.all([
              enrichWithEntities(title, content, []),
              generateEmbedding(`${title}\n\n${content}`),
            ]);

            // Apply entity enrichment (including auto-title if needed)
            const finalTitle = enrichment.newTitle || title;
            await sql`
              UPDATE notes
              SET title = ${finalTitle},
                  tags = ${enrichment.tags},
                  project = ${enrichment.project},
                  enriched_at = NOW()
              WHERE id = ${noteId}
            `;

            // Apply embedding
            if (embedding) {
              const embeddingStr = `[${embedding.join(",")}]`;
              await sql`
                UPDATE notes SET embedding = ${embeddingStr}::vector, indexed_at = NOW()
                WHERE id = ${noteId}
              `;
            }
          } catch {
            // Non-fatal
          }
        }

        processedCount++;
      } catch (error) {
        errors.push(`Page ${page.id}: ${error instanceof Error ? error.message : "Unknown"}`);
      }
    }

    cursor = searchResult.has_more ? searchResult.next_cursor ?? undefined : undefined;
  } while (cursor && processedCount < maxPages);

  return {
    count: created.length + updated.length,
    created,
    updated,
    errors,
  };
}

/**
 * Push unlinked notes to Notion
 */
async function pushToNotion(userId: string): Promise<{
  count: number;
  pushed: string[];
  errors: string[];
}> {
  const pushed: string[] = [];
  const errors: string[] = [];

  // Check if we have a parent destination configured (page or database)
  if (!process.env.NOTION_PARENT_PAGE_ID && !process.env.NOTION_PARENT_DATABASE_ID) {
    return {
      count: 0,
      pushed: [],
      errors: ["Notion parent not configured - set NOTION_PARENT_PAGE_ID or NOTION_PARENT_DATABASE_ID"],
    };
  }

  // Get notes without notion_page_id
  const notesRows = await sql`
    SELECT * FROM notes 
    WHERE user_id = ${userId} AND notion_page_id IS NULL
    ORDER BY created_at ASC
    LIMIT 50
  `;
  const notes = notesRows as Note[];

  for (const note of notes) {
    try {
      // Create page in Notion with original date
      const page = await createNotionPage(
        note.title,
        note.content,
        undefined,
        note.original_created_at || note.created_at
      );

      // Update note with notion_page_id
      await sql`
        UPDATE notes 
        SET notion_page_id = ${page.id},
            notion_last_edited = ${page.last_edited_time},
            updated_at = NOW()
        WHERE id = ${note.id}
      `;

      pushed.push(note.title);
    } catch (error) {
      errors.push(`Note ${note.id}: ${error instanceof Error ? error.message : "Unknown"}`);
    }
  }

  return {
    count: pushed.length,
    pushed,
    errors,
  };
}
