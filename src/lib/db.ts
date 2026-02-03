import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

// Entity interfaces
export interface Person {
  id: string;
  user_id: string;
  name: string;
  normalized_name: string;
  email: string | null;
  phone: string | null;
  company_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface Company {
  id: string;
  user_id: string;
  name: string;
  normalized_name: string;
  type: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface Project {
  id: string;
  user_id: string;
  name: string;
  normalized_name: string;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export interface Clarification {
  id: string;
  note_id: string;
  user_id: string;
  question: string;
  answer: string | null;
  telegram_message_id: number | null;
  status: "pending" | "answered" | "applied";
  created_at: Date;
  answered_at: Date | null;
}

// Linked entity info (for API responses)
export interface LinkedEntity {
  id: string;
  name: string;
  isNew?: boolean;
}

export interface NoteWithEntities extends Note {
  people?: LinkedEntity[];
  companies?: LinkedEntity[];
  projects?: LinkedEntity[];
}

export interface Note {
  id: string;
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

export async function getNoteById(id: string, userId: string): Promise<Note | null> {
  const rows = await sql`
    SELECT *,
      COALESCE(original_created_at, created_at) as display_created_at,
      COALESCE(original_updated_at, updated_at) as display_updated_at
    FROM notes 
    WHERE id = ${id} AND user_id = ${userId}
  `;
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
  id: string,
  userId: string,
  data: {
    title?: string;
    content?: string;
    category?: string;
    tags?: string[];
    priority?: string;
    project?: string;
    original_created_at?: Date | string | null;
    original_updated_at?: Date | string | null;
  }
): Promise<Note | null> {
  const existing = await getNoteById(id, userId);
  if (!existing) return null;

  const tagsArray = data.tags && data.tags.length > 0 ? data.tags : existing.tags;

  // Handle original date fields - only update if explicitly provided
  const originalCreatedAt = data.original_created_at !== undefined
    ? (data.original_created_at ? new Date(data.original_created_at).toISOString() : null)
    : existing.original_created_at;
  const originalUpdatedAt = data.original_updated_at !== undefined
    ? (data.original_updated_at ? new Date(data.original_updated_at).toISOString() : null)
    : existing.original_updated_at;

  const rows = await sql`
    UPDATE notes
    SET
      title = ${data.title ?? existing.title},
      content = ${data.content ?? existing.content},
      category = ${data.category ?? existing.category},
      tags = ${tagsArray},
      priority = ${data.priority ?? existing.priority},
      project = ${data.project ?? existing.project},
      original_created_at = ${originalCreatedAt},
      original_updated_at = ${originalUpdatedAt},
      updated_at = NOW()
    WHERE id = ${id} AND user_id = ${userId}
    RETURNING *
  `;
  return rows[0] as Note | null;
}

export async function deleteNote(id: string, userId: string): Promise<boolean> {
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
  noteId: string,
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
 * Get notes filtered by linked entity
 */
export async function getNotesByEntity(
  userId: string,
  entityType: "person" | "company" | "project",
  entityId: string
): Promise<Note[]> {
  let rows;

  switch (entityType) {
    case "person":
      rows = await sql`
        SELECT n.*,
          COALESCE(n.original_created_at, n.created_at) as display_created_at,
          COALESCE(n.original_updated_at, n.updated_at) as display_updated_at
        FROM notes n
        JOIN note_people np ON np.note_id = n.id
        WHERE n.user_id = ${userId} AND np.person_id = ${entityId}
        ORDER BY COALESCE(n.original_updated_at, n.updated_at) DESC
      `;
      break;
    case "company":
      rows = await sql`
        SELECT n.*,
          COALESCE(n.original_created_at, n.created_at) as display_created_at,
          COALESCE(n.original_updated_at, n.updated_at) as display_updated_at
        FROM notes n
        JOIN note_companies nc ON nc.note_id = n.id
        WHERE n.user_id = ${userId} AND nc.company_id = ${entityId}
        ORDER BY COALESCE(n.original_updated_at, n.updated_at) DESC
      `;
      break;
    case "project":
      rows = await sql`
        SELECT n.*,
          COALESCE(n.original_created_at, n.created_at) as display_created_at,
          COALESCE(n.original_updated_at, n.updated_at) as display_updated_at
        FROM notes n
        JOIN note_projects nprj ON nprj.note_id = n.id
        WHERE n.user_id = ${userId} AND nprj.project_id = ${entityId}
        ORDER BY COALESCE(n.original_updated_at, n.updated_at) DESC
      `;
      break;
  }

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

// ============================================================================
// Entity Functions - People, Companies, Projects
// ============================================================================

/**
 * Normalize a name for deduplication
 * Removes special chars, lowercases, trims
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

/**
 * Find or create a person, returns the entity with isNew flag
 */
export async function findOrCreatePerson(
  userId: string,
  name: string
): Promise<{ id: string; name: string; isNew: boolean }> {
  const normalized = normalizeName(name);
  if (!normalized) {
    throw new Error("Invalid person name");
  }

  // Upsert - insert or update name casing
  const rows = await sql`
    INSERT INTO people (user_id, name, normalized_name)
    VALUES (${userId}, ${name}, ${normalized})
    ON CONFLICT (user_id, normalized_name)
    DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
    RETURNING id, name, (xmax = 0) as is_new
  `;

  const row = rows[0] as { id: string; name: string; is_new: boolean };
  return { id: row.id, name: row.name, isNew: row.is_new };
}

/**
 * Find or create a company, returns the entity with isNew flag
 */
export async function findOrCreateCompany(
  userId: string,
  name: string,
  type?: string
): Promise<{ id: string; name: string; isNew: boolean }> {
  const normalized = normalizeName(name);
  if (!normalized) {
    throw new Error("Invalid company name");
  }

  const rows = await sql`
    INSERT INTO companies (user_id, name, normalized_name, type)
    VALUES (${userId}, ${name}, ${normalized}, ${type || null})
    ON CONFLICT (user_id, normalized_name)
    DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
    RETURNING id, name, (xmax = 0) as is_new
  `;

  const row = rows[0] as { id: string; name: string; is_new: boolean };
  return { id: row.id, name: row.name, isNew: row.is_new };
}

/**
 * Find or create a project, returns the entity with isNew flag
 */
export async function findOrCreateProject(
  userId: string,
  name: string
): Promise<{ id: string; name: string; isNew: boolean }> {
  const normalized = normalizeName(name);
  if (!normalized) {
    throw new Error("Invalid project name");
  }

  const rows = await sql`
    INSERT INTO projects (user_id, name, normalized_name)
    VALUES (${userId}, ${name}, ${normalized})
    ON CONFLICT (user_id, normalized_name)
    DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
    RETURNING id, name, (xmax = 0) as is_new
  `;

  const row = rows[0] as { id: string; name: string; is_new: boolean };
  return { id: row.id, name: row.name, isNew: row.is_new };
}

/**
 * Link a person to a note
 */
export async function linkPersonToNote(
  noteId: string,
  personId: string
): Promise<void> {
  await sql`
    INSERT INTO note_people (note_id, person_id)
    VALUES (${noteId}, ${personId})
    ON CONFLICT DO NOTHING
  `;
}

/**
 * Link a company to a note
 */
export async function linkCompanyToNote(
  noteId: string,
  companyId: string
): Promise<void> {
  await sql`
    INSERT INTO note_companies (note_id, company_id)
    VALUES (${noteId}, ${companyId})
    ON CONFLICT DO NOTHING
  `;
}

/**
 * Link a project to a note
 */
export async function linkProjectToNote(
  noteId: string,
  projectId: string
): Promise<void> {
  await sql`
    INSERT INTO note_projects (note_id, project_id)
    VALUES (${noteId}, ${projectId})
    ON CONFLICT DO NOTHING
  `;
}

/**
 * Get all entities linked to a note
 */
export async function getNoteEntities(noteId: string): Promise<{
  people: LinkedEntity[];
  companies: LinkedEntity[];
  projects: LinkedEntity[];
}> {
  const [peopleRows, companyRows, projectRows] = await Promise.all([
    sql`
      SELECT p.id, p.name
      FROM people p
      JOIN note_people np ON np.person_id = p.id
      WHERE np.note_id = ${noteId}
    `,
    sql`
      SELECT c.id, c.name
      FROM companies c
      JOIN note_companies nc ON nc.company_id = c.id
      WHERE nc.note_id = ${noteId}
    `,
    sql`
      SELECT pr.id, pr.name
      FROM projects pr
      JOIN note_projects nprj ON nprj.project_id = pr.id
      WHERE nprj.note_id = ${noteId}
    `,
  ]);

  return {
    people: peopleRows as LinkedEntity[],
    companies: companyRows as LinkedEntity[],
    projects: projectRows as LinkedEntity[],
  };
}

/**
 * Get all people for a user with note counts
 */
export async function getPeopleWithCounts(
  userId: string
): Promise<(Person & { noteCount: number })[]> {
  const rows = await sql`
    SELECT p.*, COUNT(np.note_id) as note_count
    FROM people p
    LEFT JOIN note_people np ON np.person_id = p.id
    WHERE p.user_id = ${userId}
    GROUP BY p.id
    ORDER BY note_count DESC, p.name
  `;
  return rows.map((r) => ({
    ...(r as Person),
    noteCount: parseInt((r as { note_count: string }).note_count),
  }));
}

/**
 * Get all companies for a user with note counts
 */
export async function getCompaniesWithCounts(
  userId: string
): Promise<(Company & { noteCount: number })[]> {
  const rows = await sql`
    SELECT c.*, COUNT(nc.note_id) as note_count
    FROM companies c
    LEFT JOIN note_companies nc ON nc.company_id = c.id
    WHERE c.user_id = ${userId}
    GROUP BY c.id
    ORDER BY note_count DESC, c.name
  `;
  return rows.map((r) => ({
    ...(r as Company),
    noteCount: parseInt((r as { note_count: string }).note_count),
  }));
}

/**
 * Get all projects for a user with note counts
 */
export async function getProjectsWithCounts(
  userId: string
): Promise<(Project & { noteCount: number })[]> {
  const rows = await sql`
    SELECT pr.*, COUNT(nprj.note_id) as note_count
    FROM projects pr
    LEFT JOIN note_projects nprj ON nprj.project_id = pr.id
    WHERE pr.user_id = ${userId}
    GROUP BY pr.id
    ORDER BY note_count DESC, pr.name
  `;
  return rows.map((r) => ({
    ...(r as Project),
    noteCount: parseInt((r as { note_count: string }).note_count),
  }));
}

// ============================================================================
// Clarification Functions - Persist to DB instead of memory
// ============================================================================

/**
 * Create a pending clarification for a note
 */
export async function createClarification(
  noteId: string,
  userId: string,
  question: string
): Promise<Clarification> {
  const rows = await sql`
    INSERT INTO clarifications (note_id, user_id, question, status)
    VALUES (${noteId}, ${userId}, ${question}, 'pending')
    RETURNING *
  `;
  return rows[0] as Clarification;
}

/**
 * Update clarification with Telegram message ID
 */
export async function updateClarificationTelegramId(
  noteId: string,
  telegramMessageId: number
): Promise<void> {
  await sql`
    UPDATE clarifications
    SET telegram_message_id = ${telegramMessageId}
    WHERE note_id = ${noteId} AND status = 'pending'
  `;
}

/**
 * Get pending clarification for a note
 */
export async function getPendingClarificationForNote(
  noteId: string
): Promise<Clarification | null> {
  const rows = await sql`
    SELECT * FROM clarifications
    WHERE note_id = ${noteId} AND status = 'pending'
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return (rows[0] as Clarification) || null;
}

/**
 * Get all pending clarifications for a user
 */
export async function getPendingClarifications(
  userId: string
): Promise<Clarification[]> {
  const rows = await sql`
    SELECT * FROM clarifications
    WHERE user_id = ${userId} AND status = 'pending'
    ORDER BY created_at DESC
  `;
  return rows as Clarification[];
}

/**
 * Update clarification with user's answer
 */
export async function answerClarification(
  noteId: string,
  answer: string
): Promise<Clarification | null> {
  const rows = await sql`
    UPDATE clarifications
    SET answer = ${answer}, status = 'answered', answered_at = NOW()
    WHERE note_id = ${noteId} AND status = 'pending'
    RETURNING *
  `;
  return (rows[0] as Clarification) || null;
}

/**
 * Mark clarification as applied (enrichment completed)
 */
export async function markClarificationApplied(
  noteId: string
): Promise<void> {
  await sql`
    UPDATE clarifications
    SET status = 'applied'
    WHERE note_id = ${noteId} AND status = 'answered'
  `;
}

/**
 * Get pending clarification by telegram message ID
 */
export async function getClarificationByTelegramMessageId(
  telegramMessageId: number
): Promise<Clarification | null> {
  const rows = await sql`
    SELECT * FROM clarifications
    WHERE telegram_message_id = ${telegramMessageId} AND status = 'pending'
    LIMIT 1
  `;
  return (rows[0] as Clarification) || null;
}

/**
 * Get the most recent pending clarification for a user (fallback matching)
 */
export async function getMostRecentPendingClarification(
  userId: string
): Promise<Clarification | null> {
  const rows = await sql`
    SELECT * FROM clarifications
    WHERE user_id = ${userId} AND status = 'pending'
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return (rows[0] as Clarification) || null;
}

/**
 * Get note by ID without user check (for cron jobs)
 */
export async function getNoteByIdInternal(id: string): Promise<Note | null> {
  const rows = await sql`
    SELECT *,
      COALESCE(original_created_at, created_at) as display_created_at,
      COALESCE(original_updated_at, updated_at) as display_updated_at
    FROM notes
    WHERE id = ${id}
  `;
  return rows[0] as Note | null;
}

// ============================================================================
// Project Suggestion Functions
// ============================================================================

/**
 * Get all projects for a user (for name matching)
 */
export async function getUserProjects(
  userId: string
): Promise<Project[]> {
  const rows = await sql`
    SELECT * FROM projects
    WHERE user_id = ${userId}
    ORDER BY name
  `;
  return rows as Project[];
}

/**
 * Find projects that share entities (people/companies) with a given note
 * Returns projects with overlap count for scoring
 */
export async function getProjectsWithSharedEntities(
  noteId: string,
  userId: string
): Promise<{ project: Project; overlapCount: number; sharedEntities: string[] }[]> {
  // Get entities linked to this note
  const noteEntities = await getNoteEntities(noteId);
  const personIds = noteEntities.people.map((p) => p.id);
  const companyIds = noteEntities.companies.map((c) => c.id);

  if (personIds.length === 0 && companyIds.length === 0) {
    return [];
  }

  // Find projects that have notes sharing these entities
  // Uses a CTE to find overlapping entities and count them
  const rows = await sql`
    WITH note_entity_people AS (
      SELECT person_id FROM note_people WHERE note_id = ${noteId}
    ),
    note_entity_companies AS (
      SELECT company_id FROM note_companies WHERE note_id = ${noteId}
    ),
    project_overlaps AS (
      -- Find projects with notes that share people
      SELECT DISTINCT
        pr.id as project_id,
        pr.name as project_name,
        pr.normalized_name,
        pr.status,
        pr.created_at,
        pr.updated_at,
        pe.name as entity_name,
        'person' as entity_type
      FROM projects pr
      JOIN note_projects nprj ON nprj.project_id = pr.id
      JOIN note_people np ON np.note_id = nprj.note_id
      JOIN people pe ON pe.id = np.person_id
      WHERE pr.user_id = ${userId}
        AND np.person_id IN (SELECT person_id FROM note_entity_people)
        AND nprj.note_id != ${noteId}

      UNION ALL

      -- Find projects with notes that share companies
      SELECT DISTINCT
        pr.id as project_id,
        pr.name as project_name,
        pr.normalized_name,
        pr.status,
        pr.created_at,
        pr.updated_at,
        co.name as entity_name,
        'company' as entity_type
      FROM projects pr
      JOIN note_projects nprj ON nprj.project_id = pr.id
      JOIN note_companies nc ON nc.note_id = nprj.note_id
      JOIN companies co ON co.id = nc.company_id
      WHERE pr.user_id = ${userId}
        AND nc.company_id IN (SELECT company_id FROM note_entity_companies)
        AND nprj.note_id != ${noteId}
    )
    SELECT
      project_id,
      project_name,
      normalized_name,
      status,
      created_at,
      updated_at,
      COUNT(*) as overlap_count,
      array_agg(DISTINCT entity_name) as shared_entities
    FROM project_overlaps
    GROUP BY project_id, project_name, normalized_name, status, created_at, updated_at
    ORDER BY overlap_count DESC
    LIMIT 10
  `;

  return rows.map((row) => ({
    project: {
      id: row.project_id as string,
      user_id: userId,
      name: row.project_name as string,
      normalized_name: row.normalized_name as string,
      status: row.status as string,
      created_at: row.created_at as Date,
      updated_at: row.updated_at as Date,
    },
    overlapCount: parseInt((row.overlap_count as string) || "0"),
    sharedEntities: (row.shared_entities as string[]) || [],
  }));
}

/**
 * Find projects with similar content using embedding cosine similarity
 */
export async function findSimilarProjects(
  noteEmbedding: number[],
  userId: string,
  limit: number = 5
): Promise<{ project: Project; similarity: number }[]> {
  const embeddingStr = `[${noteEmbedding.join(",")}]`;

  // Find projects whose notes have similar embeddings
  const rows = await sql`
    WITH project_similarities AS (
      SELECT
        pr.id as project_id,
        pr.name as project_name,
        pr.normalized_name,
        pr.status,
        pr.created_at,
        pr.updated_at,
        AVG(1 - (n.embedding <=> ${embeddingStr}::vector)) as avg_similarity
      FROM projects pr
      JOIN note_projects nprj ON nprj.project_id = pr.id
      JOIN notes n ON n.id = nprj.note_id
      WHERE pr.user_id = ${userId}
        AND n.embedding IS NOT NULL
      GROUP BY pr.id, pr.name, pr.normalized_name, pr.status, pr.created_at, pr.updated_at
      HAVING AVG(1 - (n.embedding <=> ${embeddingStr}::vector)) > 0.3
    )
    SELECT *
    FROM project_similarities
    ORDER BY avg_similarity DESC
    LIMIT ${limit}
  `;

  return rows.map((row) => ({
    project: {
      id: row.project_id as string,
      user_id: userId,
      name: row.project_name as string,
      normalized_name: row.normalized_name as string,
      status: row.status as string,
      created_at: row.created_at as Date,
      updated_at: row.updated_at as Date,
    },
    similarity: parseFloat((row.avg_similarity as string) || "0"),
  }));
}

/**
 * Check if a note already has a project link
 */
export async function getNoteProjectLinks(
  noteId: string
): Promise<string[]> {
  const rows = await sql`
    SELECT project_id FROM note_projects WHERE note_id = ${noteId}
  `;
  return rows.map((r) => (r as { project_id: string }).project_id);
}

/**
 * Get note embedding by ID
 */
export async function getNoteEmbedding(
  noteId: string
): Promise<number[] | null> {
  const rows = await sql`
    SELECT embedding FROM notes WHERE id = ${noteId} AND embedding IS NOT NULL
  `;

  if (rows.length === 0 || !rows[0].embedding) {
    return null;
  }

  // Parse the vector string back to array
  const vectorStr = rows[0].embedding.toString();
  const match = vectorStr.match(/\[(.*)\]/);
  if (!match) return null;

  return match[1].split(",").map((v: string) => parseFloat(v.trim()));
}
