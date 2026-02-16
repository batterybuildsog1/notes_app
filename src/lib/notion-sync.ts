/**
 * Notion Sync Library
 * Bidirectional sync between Notion and the notes app
 */

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_VERSION = "2025-09-03";
const NOTION_BASE_URL = "https://api.notion.com/v1";

// Parent destination for created notes in Notion.
// Prefer a data source (database) when available; page parent is also supported.
const NOTION_PARENT_PAGE_ID = process.env.NOTION_PARENT_PAGE_ID;
const NOTION_PARENT_DATABASE_ID = process.env.NOTION_PARENT_DATABASE_ID;

interface NotionPage {
  id: string;
  created_time: string;
  last_edited_time: string;
  archived: boolean;
  properties: {
    title?: {
      title: Array<{ plain_text: string }>;
    };
    [key: string]: unknown;
  };
  parent: {
    type: string;
    workspace?: boolean;
    page_id?: string;
    database_id?: string;
  };
}

interface NotionBlock {
  id: string;
  type: string;
  [key: string]: unknown;
}

interface NotionSearchResult {
  object: string;
  results: NotionPage[];
  next_cursor: string | null;
  has_more: boolean;
}

interface SyncResult {
  pulled: number;
  pushed: number;
  errors: string[];
}

/**
 * Make authenticated request to Notion API
 */
async function notionRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  if (!NOTION_API_KEY) {
    throw new Error("NOTION_API_KEY not configured");
  }

  const response = await fetch(`${NOTION_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Notion API error: ${response.status} - ${error}`);
  }

  return response.json();
}

/**
 * Search Notion for pages modified since a given time
 */
export async function searchNotionPages(
  since?: Date,
  cursor?: string
): Promise<NotionSearchResult> {
  const filters: Record<string, unknown>[] = [
    {
      property: "object",
      value: "page",
    },
  ];

  if (since) {
    filters.push({
      timestamp: "last_edited_time",
      last_edited_time: {
        on_or_after: since.toISOString(),
      },
    });
  }

  const body: Record<string, unknown> = {
    page_size: 100,
    filter: filters.length === 1 ? filters[0] : { and: filters },
    sort: {
      direction: "descending",
      timestamp: "last_edited_time",
    },
  };

  if (cursor) {
    body.start_cursor = cursor;
  }

  return notionRequest<NotionSearchResult>("/search", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * Get all blocks (content) from a Notion page
 */
export async function getPageBlocks(pageId: string): Promise<NotionBlock[]> {
  const blocks: NotionBlock[] = [];
  let cursor: string | undefined;

  do {
    const endpoint = `/blocks/${pageId}/children${cursor ? `?start_cursor=${cursor}` : ""}`;
    const result = await notionRequest<{
      results: NotionBlock[];
      next_cursor: string | null;
      has_more: boolean;
    }>(endpoint);

    blocks.push(...result.results);
    cursor = result.next_cursor ?? undefined;
  } while (cursor);

  return blocks;
}

/**
 * Convert Notion blocks to markdown
 */
export function blocksToMarkdown(blocks: NotionBlock[]): string {
  const lines: string[] = [];

  for (const block of blocks) {
    const line = blockToMarkdown(block);
    if (line !== null) {
      lines.push(line);
    }
  }

  return lines.join("\n\n");
}

function blockToMarkdown(block: NotionBlock): string | null {
  const type = block.type;
  const data = block[type] as Record<string, unknown>;

  if (!data) return null;

  switch (type) {
    case "paragraph":
      return richTextToMarkdown(data.rich_text as RichText[]);

    case "heading_1":
      return `# ${richTextToMarkdown(data.rich_text as RichText[])}`;

    case "heading_2":
      return `## ${richTextToMarkdown(data.rich_text as RichText[])}`;

    case "heading_3":
      return `### ${richTextToMarkdown(data.rich_text as RichText[])}`;

    case "bulleted_list_item":
      return `- ${richTextToMarkdown(data.rich_text as RichText[])}`;

    case "numbered_list_item":
      return `1. ${richTextToMarkdown(data.rich_text as RichText[])}`;

    case "to_do":
      const checked = data.checked ? "[x]" : "[ ]";
      return `- ${checked} ${richTextToMarkdown(data.rich_text as RichText[])}`;

    case "toggle":
      return `<details><summary>${richTextToMarkdown(data.rich_text as RichText[])}</summary></details>`;

    case "code":
      const lang = (data.language as string) || "";
      return `\`\`\`${lang}\n${richTextToMarkdown(data.rich_text as RichText[])}\n\`\`\``;

    case "quote":
      return `> ${richTextToMarkdown(data.rich_text as RichText[])}`;

    case "divider":
      return "---";

    case "callout":
      const icon = (data.icon as { emoji?: string })?.emoji || "💡";
      return `> ${icon} ${richTextToMarkdown(data.rich_text as RichText[])}`;

    case "image":
      const imageUrl =
        (data.file as { url?: string })?.url ||
        (data.external as { url?: string })?.url ||
        "";
      const caption = richTextToMarkdown(data.caption as RichText[]);
      return `![${caption || "image"}](${imageUrl})`;

    case "bookmark":
      const bookmarkUrl = data.url as string;
      return `[${bookmarkUrl}](${bookmarkUrl})`;

    case "link_preview":
      const previewUrl = data.url as string;
      return `[${previewUrl}](${previewUrl})`;

    case "table":
    case "column_list":
    case "column":
    case "child_page":
    case "child_database":
      // Skip complex nested blocks for now
      return null;

    default:
      // Unknown block type, try to extract text
      if (data.rich_text) {
        return richTextToMarkdown(data.rich_text as RichText[]);
      }
      return null;
  }
}

interface RichText {
  type: string;
  plain_text: string;
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    strikethrough?: boolean;
    underline?: boolean;
    code?: boolean;
  };
  href?: string;
}

function richTextToMarkdown(richTexts: RichText[]): string {
  if (!richTexts || !Array.isArray(richTexts)) return "";

  return richTexts
    .map((rt) => {
      let text = rt.plain_text || "";
      const ann = rt.annotations || {};

      if (ann.code) text = `\`${text}\``;
      if (ann.bold) text = `**${text}**`;
      if (ann.italic) text = `*${text}*`;
      if (ann.strikethrough) text = `~~${text}~~`;
      if (rt.href) text = `[${text}](${rt.href})`;

      return text;
    })
    .join("");
}

/**
 * Extract title from Notion page
 */
export function getPageTitle(page: NotionPage): string {
  const properties = page.properties || {};

  // 1) Common case: top-level property named "title"
  const directTitle = properties.title as
    | { title?: Array<{ plain_text: string }> }
    | undefined;
  if (directTitle?.title?.length) {
    const text = directTitle.title.map((t) => t.plain_text).join("").trim();
    if (text) return text;
  }

  // 2) Database rows often use a custom property name with type=title
  for (const value of Object.values(properties) as Array<
    { type?: string; title?: Array<{ plain_text: string }> } | undefined
  >) {
    if (value?.type === "title" && value.title?.length) {
      const text = value.title.map((t) => t.plain_text).join("").trim();
      if (text) return text;
    }
  }

  return "Untitled";
}

/**
 * Create a new page in Notion
 */
export async function createNotionPage(
  title: string,
  content: string,
  parentPageId?: string,
  originalCreatedAt?: Date | string | null
): Promise<NotionPage> {
  const parent = parentPageId || NOTION_PARENT_PAGE_ID;

  if (!parent && !NOTION_PARENT_DATABASE_ID) {
    throw new Error(
      "No Notion parent configured for creating pages. Set NOTION_PARENT_PAGE_ID or NOTION_PARENT_DATABASE_ID."
    );
  }

  // Convert markdown to Notion blocks
  const blocks = markdownToBlocks(content);

  // Prepend callout with original creation date if available
  if (originalCreatedAt) {
    const dateStr = new Date(originalCreatedAt).toISOString().split('T')[0];
    blocks.unshift({
      object: "block",
      type: "callout",
      callout: {
        rich_text: [{ type: "text", text: { content: `Originally created: ${dateStr}` } }],
        icon: { emoji: "📅" }
      }
    });
  }

  const body = {
    parent: parent
      ? { page_id: parent }
      : { database_id: NOTION_PARENT_DATABASE_ID as string },
    properties: {
      title: {
        title: [
          {
            text: {
              content: title,
            },
          },
        ],
      },
    },
    children: blocks,
  };

  return notionRequest<NotionPage>("/pages", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * Update an existing Notion page
 */
export async function updateNotionPage(
  pageId: string,
  title?: string,
  content?: string
): Promise<NotionPage> {
  // Update title if provided
  if (title) {
    await notionRequest(`/pages/${pageId}`, {
      method: "PATCH",
      body: JSON.stringify({
        properties: {
          title: {
            title: [
              {
                text: {
                  content: title,
                },
              },
            ],
          },
        },
      }),
    });
  }

  // Update content if provided
  if (content) {
    // First, get existing blocks and archive them
    const existingBlocks = await getPageBlocks(pageId);
    for (const block of existingBlocks) {
      try {
        await notionRequest(`/blocks/${block.id}`, {
          method: "DELETE",
        });
      } catch {
        // Ignore errors deleting blocks
      }
    }

    // Add new blocks
    const blocks = markdownToBlocks(content);
    if (blocks.length > 0) {
      await notionRequest(`/blocks/${pageId}/children`, {
        method: "PATCH",
        body: JSON.stringify({ children: blocks }),
      });
    }
  }

  // Return updated page
  return notionRequest<NotionPage>(`/pages/${pageId}`);
}

/**
 * Convert markdown to Notion blocks (simplified)
 */
function markdownToBlocks(markdown: string): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = [];
  const lines = markdown.split("\n");

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Skip empty lines
    if (!line.trim()) {
      i++;
      continue;
    }

    // Code block
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim() || "plain text";
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push({
        object: "block",
        type: "code",
        code: {
          rich_text: [{ type: "text", text: { content: codeLines.join("\n") } }],
          language: lang,
        },
      });
      i++;
      continue;
    }

    // Headings
    if (line.startsWith("### ")) {
      blocks.push({
        object: "block",
        type: "heading_3",
        heading_3: {
          rich_text: [{ type: "text", text: { content: line.slice(4) } }],
        },
      });
    } else if (line.startsWith("## ")) {
      blocks.push({
        object: "block",
        type: "heading_2",
        heading_2: {
          rich_text: [{ type: "text", text: { content: line.slice(3) } }],
        },
      });
    } else if (line.startsWith("# ")) {
      blocks.push({
        object: "block",
        type: "heading_1",
        heading_1: {
          rich_text: [{ type: "text", text: { content: line.slice(2) } }],
        },
      });
    }
    // Quote
    else if (line.startsWith("> ")) {
      blocks.push({
        object: "block",
        type: "quote",
        quote: {
          rich_text: [{ type: "text", text: { content: line.slice(2) } }],
        },
      });
    }
    // Bullet list
    else if (line.startsWith("- ") || line.startsWith("* ")) {
      // Check for checkbox
      const rest = line.slice(2);
      if (rest.startsWith("[x] ") || rest.startsWith("[ ] ")) {
        blocks.push({
          object: "block",
          type: "to_do",
          to_do: {
            rich_text: [{ type: "text", text: { content: rest.slice(4) } }],
            checked: rest.startsWith("[x]"),
          },
        });
      } else {
        blocks.push({
          object: "block",
          type: "bulleted_list_item",
          bulleted_list_item: {
            rich_text: [{ type: "text", text: { content: rest } }],
          },
        });
      }
    }
    // Numbered list
    else if (/^\d+\.\s/.test(line)) {
      const content = line.replace(/^\d+\.\s/, "");
      blocks.push({
        object: "block",
        type: "numbered_list_item",
        numbered_list_item: {
          rich_text: [{ type: "text", text: { content } }],
        },
      });
    }
    // Divider
    else if (line === "---" || line === "***") {
      blocks.push({
        object: "block",
        type: "divider",
        divider: {},
      });
    }
    // Regular paragraph
    else {
      blocks.push({
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [{ type: "text", text: { content: line } }],
        },
      });
    }

    i++;
  }

  return blocks;
}

/**
 * Infer category from Notion page parent or content
 */
export function inferCategory(page: NotionPage, content: string): string | null {
  // Try to infer from parent page name or database
  // For now, return null and let the user categorize
  // Could be enhanced to look at parent page title or database name
  return null;
}

/**
 * Check if Notion API is configured and working
 */
export async function checkNotionConnection(): Promise<{
  ok: boolean;
  error?: string;
  user?: string;
}> {
  if (!NOTION_API_KEY) {
    return { ok: false, error: "NOTION_API_KEY not configured" };
  }

  try {
    const result = await notionRequest<{ bot: { owner: { user?: { name: string } } } }>("/users/me");
    return {
      ok: true,
      user: result.bot?.owner?.user?.name || "Unknown",
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export type { NotionPage, NotionBlock, SyncResult };
