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
  created_at: Date;
  updated_at: Date;
}

export async function getNotes(userId: string, search?: string, category?: string): Promise<Note[]> {
  const hasSearch = search && search.trim().length > 0;
  const hasCategory = category && category !== "all";
  const searchPattern = hasSearch ? `%${search.trim()}%` : null;

  if (hasSearch && hasCategory) {
    const rows = await sql`
      SELECT * FROM notes
      WHERE user_id = ${userId}
        AND category = ${category}
        AND (title ILIKE ${searchPattern} OR content ILIKE ${searchPattern})
      ORDER BY updated_at DESC
    `;
    return rows as Note[];
  }

  if (hasSearch) {
    const rows = await sql`
      SELECT * FROM notes
      WHERE user_id = ${userId}
        AND (title ILIKE ${searchPattern} OR content ILIKE ${searchPattern})
      ORDER BY updated_at DESC
    `;
    return rows as Note[];
  }

  if (hasCategory) {
    const rows = await sql`SELECT * FROM notes WHERE user_id = ${userId} AND category = ${category} ORDER BY updated_at DESC`;
    return rows as Note[];
  }

  const rows = await sql`SELECT * FROM notes WHERE user_id = ${userId} ORDER BY updated_at DESC`;
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
}): Promise<Note> {
  const tagsArray = data.tags && data.tags.length > 0 ? data.tags : null;

  const rows = await sql`
    INSERT INTO notes (title, content, user_id, category, tags, priority, project, created_at, updated_at)
    VALUES (
      ${data.title},
      ${data.content},
      ${data.user_id},
      ${data.category || null},
      ${tagsArray},
      ${data.priority || null},
      ${data.project || null},
      NOW(),
      NOW()
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
