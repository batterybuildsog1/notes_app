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
  type NotionPage,
} from "@/lib/notion-sync";
import { generateEmbedding } from "@/lib/enrichment";

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

    return NextResponse.json({
      notion: notionStatus,
      sync: {
        lastPullAt: state?.last_pull_at || null,
        lastPushAt: state?.last_push_at || null,
        linkedNotes: linkedCount,
        unlinkedNotes: unlinkedCount,
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

    return NextResponse.json({
      ok: result.errors.length === 0,
      ...result,
    });
  } catch (error) {
    console.error("Sync error:", error);
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
          // Update existing note if Notion version is newer
          const noteUpdatedAt = new Date(existing.updated_at);
          if (pageEditedAt > noteUpdatedAt) {
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

            // Regenerate embedding
            try {
              const embedding = await generateEmbedding(`${title}\n\n${content}`);
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

          // Generate embedding
          try {
            const embedding = await generateEmbedding(`${title}\n\n${content}`);
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

  // Check if we have a parent page configured
  if (!process.env.NOTION_PARENT_PAGE_ID) {
    return {
      count: 0,
      pushed: [],
      errors: ["NOTION_PARENT_PAGE_ID not configured - push disabled"],
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
