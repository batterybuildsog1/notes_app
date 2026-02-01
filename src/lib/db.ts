import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

export interface Note {
  id: number;
  title: string;
  content: string;
  category: string | null;
  tags: string[] | null;
  priority: string | null;
  project: string | null;
  source: string | null;
  user_id: string;
  created_at: Date;           // System timestamp
  updated_at: Date;           // System timestamp
  original_created_at: Date | null;  // From source (Evernote/Notion)
  original_updated_at: Date | null;  // From source (Evernote/Notion)
  display_created_at?: Date;  // Computed: COALESCE(original_created_at, created_at)
  display_updated_at?: Date;  // Computed: COALESCE(original_updated_at, updated_at)
  notion_page_id?: string | null;
  notion_last_edited?: Date | null;
}

export async function getNotes(userId: string, search?: string, category?: string): Promise<Note[]> {
  const hasSearch = search && search.trim().length > 0;
  const hasCategory = category && category !== "all";
  const searchPattern = hasSearch ? `%${search.trim()}%` : null;

  if (hasSearch && hasCategory) {
    const rows = await sql`
      SELECT *,
        COALESCE(original_created_at, created_at) as display_created_at,
        COALESCE(original_updated_at, updated_at) as display_updated_at
      FROM notes
      WHERE user_id = ${userId}
        AND category = ${category}
        AND (title ILIKE ${searchPattern} OR content ILIKE ${searchPattern})
      ORDER BY COALESCE(original_updated_at, updated_at) DESC
    `;
    return rows as Note[];
  }

  if (hasSearch) {
    const rows = await sql`
      SELECT *,
        COALESCE(original_created_at, created_at) as display_created_at,
        COALESCE(original_updated_at, updated_at) as display_updated_at
      FROM notes
      WHERE user_id = ${userId}
        AND (title ILIKE ${searchPattern} OR content ILIKE ${searchPattern})
      ORDER BY COALESCE(original_updated_at, updated_at) DESC
    `;
    return rows as Note[];
  }

  if (hasCategory) {
    const rows = await sql`
      SELECT *,
        COALESCE(original_created_at, created_at) as display_created_at,
        COALESCE(original_updated_at, updated_at) as display_updated_at
      FROM notes 
      WHERE user_id = ${userId} AND category = ${category} 
      ORDER BY COALESCE(original_updated_at, updated_at) DESC
    `;
    return rows as Note[];
  }

  const rows = await sql`
    SELECT *,
      COALESCE(original_created_at, created_at) as display_created_at,
      COALESCE(original_updated_at, updated_at) as display_updated_at
    FROM notes 
    WHERE user_id = ${userId} 
    ORDER BY COALESCE(original_updated_at, updated_at) DESC
  `;
  return rows as Note[];
}

export async function getNoteById(id: number, userId: string): Promise<Note | null> {
  const rows = await sql`SELECT * FROM notes WHERE id = ${id} AND user_id = ${userId}`;
  return rows[0] as Note | null;
}

export async function createNote(data: {
  title: string;
  content: string;
  user_id: string;
  category?: string;
  tags?: string[];
  priority?: string;
  project?: string;
  original_created_at?: string | Date;
  original_updated_at?: string | Date;
}): Promise<Note> {
  const tagsArray = data.tags && data.tags.length > 0 ? data.tags : null;
  const originalCreatedAt = data.original_created_at 
    ? (typeof data.original_created_at === 'string' ? data.original_created_at : data.original_created_at.toISOString())
    : null;
  const originalUpdatedAt = data.original_updated_at
    ? (typeof data.original_updated_at === 'string' ? data.original_updated_at : data.original_updated_at.toISOString())
    : null;

  const rows = await sql`
    INSERT INTO notes (title, content, user_id, category, tags, priority, project, created_at, updated_at, original_created_at, original_updated_at)
    VALUES (
      ${data.title},
      ${data.content},
      ${data.user_id},
      ${data.category || null},
      ${tagsArray},
      ${data.priority || null},
      ${data.project || null},
      NOW(),
      NOW(),
      ${originalCreatedAt},
      ${originalUpdatedAt}
    )
    RETURNING *
  `;
  return rows[0] as Note;
}

export async function updateNote(
  id: number,
  userId: string,
  data: {
    title?: string;
    content?: string;
    category?: string;
    tags?: string[];
    priority?: string;
    project?: string;
  }
): Promise<Note | null> {
  const existing = await getNoteById(id, userId);
  if (!existing) return null;

  const tagsArray = data.tags && data.tags.length > 0 ? data.tags : existing.tags;

  const rows = await sql`
    UPDATE notes
    SET
      title = ${data.title ?? existing.title},
      content = ${data.content ?? existing.content},
      category = ${data.category ?? existing.category},
      tags = ${tagsArray},
      priority = ${data.priority ?? existing.priority},
      project = ${data.project ?? existing.project},
      updated_at = NOW()
    WHERE id = ${id} AND user_id = ${userId}
    RETURNING *
  `;
  return rows[0] as Note | null;
}

export async function deleteNote(id: number, userId: string): Promise<boolean> {
  await sql`DELETE FROM notes WHERE id = ${id} AND user_id = ${userId}`;
  return true;
}

export async function getCategories(userId: string): Promise<string[]> {
  const rows = await sql`SELECT DISTINCT category FROM notes WHERE user_id = ${userId} AND category IS NOT NULL ORDER BY category`;
  return rows.map((row) => (row as { category: string }).category);
}

/**
 * Update note embedding after enrichment
 */
export async function updateNoteEmbedding(
  noteId: number,
  embedding: number[]
): Promise<void> {
  const embeddingStr = `[${embedding.join(",")}]`;
  await sql`
    UPDATE notes
    SET embedding = ${embeddingStr}::vector, indexed_at = NOW()
    WHERE id = ${noteId}
  `;
}

/**
 * Get notes updated since a given date
 */
export async function getNotesUpdatedSince(
  userId: string,
  since: Date
): Promise<Note[]> {
  const rows = await sql`
    SELECT * FROM notes 
    WHERE user_id = ${userId} AND updated_at > ${since.toISOString()}
    ORDER BY updated_at DESC
  `;
  return rows as Note[];
}

/**
 * Get note statistics for a user
 */
export async function getNoteStats(userId: string): Promise<{
  total: number;
  byCategory: Record<string, number>;
  withoutCategory: number;
  withoutTags: number;
  withEmbeddings: number;
}> {
  const [totalResult, categoryResult, noCategoryResult, noTagsResult, embeddingResult] = await Promise.all([
    sql`SELECT COUNT(*) as count FROM notes WHERE user_id = ${userId}`,
    sql`SELECT category, COUNT(*) as count FROM notes WHERE user_id = ${userId} AND category IS NOT NULL GROUP BY category`,
    sql`SELECT COUNT(*) as count FROM notes WHERE user_id = ${userId} AND category IS NULL`,
    sql`SELECT COUNT(*) as count FROM notes WHERE user_id = ${userId} AND (tags IS NULL OR array_length(tags, 1) IS NULL)`,
    sql`SELECT COUNT(*) as count FROM notes WHERE user_id = ${userId} AND embedding IS NOT NULL`,
  ]);

  const byCategory: Record<string, number> = {};
  for (const row of categoryResult) {
    const r = row as { category: string; count: string };
    byCategory[r.category] = parseInt(r.count);
  }

  return {
    total: parseInt((totalResult[0] as { count: string }).count),
    byCategory,
    withoutCategory: parseInt((noCategoryResult[0] as { count: string }).count),
    withoutTags: parseInt((noTagsResult[0] as { count: string }).count),
    withEmbeddings: parseInt((embeddingResult[0] as { count: string }).count),
  };
}
