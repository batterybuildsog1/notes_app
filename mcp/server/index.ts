#!/usr/bin/env node
/**
 * MCP Server for Notes App
 *
 * A proxy layer that exposes the Notes App API as MCP tools.
 * All business logic lives in the Next.js API routes - this server
 * just translates MCP tool calls into HTTP requests.
 *
 * Environment variables:
 *   NOTES_APP_URL - Base URL of the notes app (e.g., https://notes.example.com)
 *   NOTES_API_KEY - API key for authentication
 *   NOTES_USER_ID - User ID for service auth (optional, defaults to 'mcp-user')
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

// ============================================================================
// Configuration
// ============================================================================

const NOTES_APP_URL = process.env.NOTES_APP_URL || "http://localhost:3000";
const NOTES_API_KEY = process.env.NOTES_API_KEY || "";
const NOTES_USER_ID = process.env.NOTES_USER_ID || "mcp-user";

function log(message: string, ...args: unknown[]): void {
  console.error(`[notes-mcp] ${message}`, ...args);
}

// ============================================================================
// Tool Definitions
// ============================================================================

interface ToolDefinition {
  name: string;
  description: string;
  endpoint: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  parameters: {
    type: "object";
    properties: Record<string, object>;
    required?: string[];
  };
}

// Define tools inline for simplicity and type safety
// These mirror the definitions in notes-server.json
const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "create_note",
    description:
      "Create a new note. The note will be automatically enriched with entity extraction (people, companies, projects).",
    endpoint: "/api/notes",
    method: "POST",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Title of the note (max 500 chars)",
        },
        content: {
          type: "string",
          description: "Body content of the note (max 100,000 chars)",
        },
        category: {
          type: "string",
          description:
            "Category for organization (e.g., 'work', 'personal', 'real-estate')",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Array of tags for the note",
        },
        priority: {
          type: "string",
          enum: ["low", "medium", "high"],
          description: "Priority level",
        },
        project: {
          type: "string",
          description: "Project name this note belongs to",
        },
        source: {
          type: "string",
          description:
            "Agent source ID (e.g., 'pm-agent', 'swarm-orch'). Used to attribute notes to agents.",
        },
        external_event_id: {
          type: "string",
          description:
            "Deduplication key. If a note with this ID already exists for the user, it will be updated instead of creating a duplicate.",
        },
      },
      required: ["title", "content"],
    },
  },
  {
    name: "update_note",
    description:
      "Update an existing note by ID. Only provided fields will be updated.",
    endpoint: "/api/notes/{noteId}",
    method: "PUT",
    parameters: {
      type: "object",
      properties: {
        noteId: {
          type: "string",
          description: "UUID of the note to update",
        },
        title: { type: "string", description: "New title" },
        content: { type: "string", description: "New content" },
        category: { type: "string", description: "New category" },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "New tags array (replaces existing)",
        },
        priority: {
          type: "string",
          enum: ["low", "medium", "high"],
        },
        project: { type: "string", description: "Project name" },
      },
      required: ["noteId"],
    },
  },
  {
    name: "delete_note",
    description: "Delete a note by ID. This also removes all entity links.",
    endpoint: "/api/notes/{noteId}",
    method: "DELETE",
    parameters: {
      type: "object",
      properties: {
        noteId: {
          type: "string",
          description: "UUID of the note to delete",
        },
      },
      required: ["noteId"],
    },
  },
  {
    name: "get_note",
    description:
      "Get a single note by ID, including linked entities (people, companies, projects).",
    endpoint: "/api/notes/{noteId}",
    method: "GET",
    parameters: {
      type: "object",
      properties: {
        noteId: {
          type: "string",
          description: "UUID of the note to retrieve",
        },
      },
      required: ["noteId"],
    },
  },
  {
    name: "search_notes",
    description:
      "Search notes by text query, category, or linked entity. Returns notes with their linked entities.",
    endpoint: "/api/notes",
    method: "GET",
    parameters: {
      type: "object",
      properties: {
        search: {
          type: "string",
          description: "Text search query (searches title and content)",
        },
        category: { type: "string", description: "Filter by category" },
        person: {
          type: "string",
          description: "Filter by linked person ID",
        },
        company: {
          type: "string",
          description: "Filter by linked company ID",
        },
        project: {
          type: "string",
          description: "Filter by linked project ID",
        },
        projectExternalId: {
          type: "string",
          description:
            "Filter by project external ID (e.g., 'TR-1.0'). Alternative to project UUID.",
        },
        source: {
          type: "string",
          description:
            "Filter by agent source ID (e.g., 'pm-agent', 'swarm-orch')",
        },
      },
    },
  },
  {
    name: "semantic_search",
    description:
      "Search notes using semantic similarity (AI-powered). Finds conceptually related notes even without exact keyword matches.",
    endpoint: "/api/notes/semantic-search",
    method: "POST",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural language search query",
        },
        limit: {
          type: "integer",
          description: "Maximum number of results (default: 10, max: 50)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "list_people",
    description:
      "List all people in the CRM with their note counts. People are automatically extracted from notes.",
    endpoint: "/api/people",
    method: "GET",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "create_person",
    description:
      "Manually create a person entity. Usually not needed as people are auto-extracted from notes.",
    endpoint: "/api/people",
    method: "POST",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Full name of the person",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "list_companies",
    description:
      "List all companies in the CRM with their note counts. Companies include banks, vendors, contractors, etc.",
    endpoint: "/api/companies",
    method: "GET",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "create_company",
    description:
      "Manually create a company entity. Usually not needed as companies are auto-extracted from notes.",
    endpoint: "/api/companies",
    method: "POST",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Company name",
        },
        type: {
          type: "string",
          description:
            "Company type (e.g., 'bank', 'contractor', 'vendor', 'agency')",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "list_projects",
    description:
      "List all projects in the CRM with their note counts. Projects represent deals, developments, or initiatives.",
    endpoint: "/api/projects",
    method: "GET",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "create_project",
    description:
      "Manually create a project entity. Usually not needed as projects are auto-extracted from notes.",
    endpoint: "/api/projects",
    method: "POST",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Project name",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "link_to_entity",
    description:
      "Link a note to a person, company, or project. Can link by entity ID or by name (creates entity if needed).",
    endpoint: "/api/notes/{noteId}/link",
    method: "POST",
    parameters: {
      type: "object",
      properties: {
        noteId: { type: "string", description: "UUID of the note" },
        type: {
          type: "string",
          enum: ["person", "company", "project"],
          description: "Type of entity to link",
        },
        entityId: {
          type: "string",
          description: "UUID of existing entity to link (use this OR name)",
        },
        name: {
          type: "string",
          description: "Name of entity to link (creates if doesn't exist)",
        },
      },
      required: ["noteId", "type"],
    },
  },
  {
    name: "unlink_from_entity",
    description: "Remove a link between a note and an entity.",
    endpoint: "/api/notes/{noteId}/link",
    method: "DELETE",
    parameters: {
      type: "object",
      properties: {
        noteId: { type: "string", description: "UUID of the note" },
        type: {
          type: "string",
          enum: ["person", "company", "project"],
          description: "Type of entity to unlink",
        },
        entityId: {
          type: "string",
          description: "UUID of entity to unlink",
        },
      },
      required: ["noteId", "type", "entityId"],
    },
  },
  {
    name: "split_note",
    description:
      "Split a single note into multiple new notes. Useful for breaking up long notes. Entity links are copied to all new notes.",
    endpoint: "/api/notes/split",
    method: "POST",
    parameters: {
      type: "object",
      properties: {
        noteId: {
          type: "string",
          description: "UUID of the note to split",
        },
        splits: {
          type: "array",
          description: "Array of new notes to create (max 10)",
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "Title for new note" },
              content: {
                type: "string",
                description: "Content for new note",
              },
              category: {
                type: "string",
                description: "Optional category override",
              },
              tags: {
                type: "array",
                items: { type: "string" },
                description: "Optional tags override",
              },
            },
            required: ["title", "content"],
          },
        },
        deleteOriginal: {
          type: "boolean",
          description: "Whether to delete the original note after splitting",
        },
      },
      required: ["noteId", "splits"],
    },
  },
  {
    name: "merge_notes",
    description:
      "Merge multiple notes into a single new note. Combines content, merges all entity links, and deletes originals.",
    endpoint: "/api/notes/merge",
    method: "POST",
    parameters: {
      type: "object",
      properties: {
        noteIds: {
          type: "array",
          description: "Array of note UUIDs to merge (2-20 notes)",
          items: { type: "string" },
        },
        newTitle: {
          type: "string",
          description: "Title for the merged note",
        },
        separator: {
          type: "string",
          description: "Text to insert between merged content",
        },
      },
      required: ["noteIds", "newTitle"],
    },
  },
  {
    name: "clarify_note",
    description:
      "Provide additional context for a note that was flagged as vague. Triggers re-enrichment with the new context.",
    endpoint: "/api/notes/clarify",
    method: "POST",
    parameters: {
      type: "object",
      properties: {
        noteId: {
          type: "string",
          description: "UUID of the note needing clarification",
        },
        context: {
          type: "string",
          description:
            "Additional context to help enrich the note (e.g., full names, company names, project details)",
        },
      },
      required: ["noteId", "context"],
    },
  },
  {
    name: "get_pending_clarifications",
    description:
      "List notes that need additional context/clarification for proper entity extraction.",
    endpoint: "/api/notes/clarify",
    method: "GET",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_stats",
    description:
      "Get statistics about the notes database including counts by category and enrichment status.",
    endpoint: "/api/notes/stats",
    method: "GET",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "suggest_projects",
    description:
      "Get project suggestions for a note based on extracted entities, shared entities with other project notes, keyword matching, and semantic similarity.",
    endpoint: "/api/notes/{noteId}/suggest-projects",
    method: "GET",
    parameters: {
      type: "object",
      properties: {
        noteId: {
          type: "string",
          description: "UUID of the note to get project suggestions for",
        },
      },
      required: ["noteId"],
    },
  },
  {
    name: "get_usage",
    description:
      "Get token usage statistics for AI enrichment operations. Tracks OpenAI API costs.",
    endpoint: "/api/usage",
    method: "GET",
    parameters: {
      type: "object",
      properties: {
        period: {
          type: "string",
          enum: ["today", "week", "month", "all"],
          description: "Time period for usage stats",
        },
        noteId: {
          type: "string",
          description:
            "Optional: Get usage for a specific note instead of time period",
        },
      },
    },
  },
];

// Convert our definitions to MCP Tool format
function toMcpTools(): Tool[] {
  return TOOL_DEFINITIONS.map((def) => ({
    name: def.name,
    description: def.description,
    inputSchema: {
      type: "object" as const,
      properties: def.parameters.properties,
      required: def.parameters.required,
    },
  }));
}

// ============================================================================
// HTTP Client
// ============================================================================

interface ApiResponse {
  ok: boolean;
  status: number;
  data: unknown;
}

async function callApi(
  endpoint: string,
  method: string,
  body?: Record<string, unknown>,
  queryParams?: Record<string, string>
): Promise<ApiResponse> {
  let url = `${NOTES_APP_URL}${endpoint}`;

  // Add query params for GET requests
  if (queryParams && Object.keys(queryParams).length > 0) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(queryParams)) {
      if (value !== undefined && value !== null && value !== "") {
        params.append(key, value);
      }
    }
    const paramString = params.toString();
    if (paramString) {
      url += `?${paramString}`;
    }
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // Add auth headers
  if (NOTES_API_KEY) {
    headers["X-API-Key"] = NOTES_API_KEY;
  }
  if (NOTES_USER_ID) {
    headers["X-User-Id"] = NOTES_USER_ID;
  }

  log(`${method} ${url}`);

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    let data: unknown;
    const contentType = response.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    return {
      ok: response.ok,
      status: response.status,
      data,
    };
  } catch (error) {
    log("API call failed:", error);
    return {
      ok: false,
      status: 0,
      data: { error: error instanceof Error ? error.message : "Unknown error" },
    };
  }
}

// ============================================================================
// Tool Execution
// ============================================================================

interface ToolArgs {
  [key: string]: unknown;
}

function findTool(name: string): ToolDefinition | undefined {
  return TOOL_DEFINITIONS.find((t) => t.name === name);
}

function buildEndpoint(
  template: string,
  args: ToolArgs
): { endpoint: string; remainingArgs: ToolArgs } {
  let endpoint = template;
  const remainingArgs: ToolArgs = { ...args };

  // Replace path parameters like {noteId}
  const pathParams = template.match(/\{(\w+)\}/g) || [];
  for (const param of pathParams) {
    const paramName = param.slice(1, -1); // Remove { and }
    const value = args[paramName];
    if (value !== undefined) {
      endpoint = endpoint.replace(param, String(value));
      delete remainingArgs[paramName];
    }
  }

  return { endpoint, remainingArgs };
}

async function executeTool(
  name: string,
  args: ToolArgs
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const tool = findTool(name);
  if (!tool) {
    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }

  // Build the endpoint, extracting path parameters
  const { endpoint, remainingArgs } = buildEndpoint(tool.endpoint, args);

  // Make the API call
  let response: ApiResponse;

  if (tool.method === "GET") {
    // Convert remaining args to query params
    const queryParams: Record<string, string> = {};
    for (const [key, value] of Object.entries(remainingArgs)) {
      if (value !== undefined && value !== null) {
        queryParams[key] = String(value);
      }
    }
    response = await callApi(endpoint, "GET", undefined, queryParams);
  } else if (tool.method === "DELETE") {
    // DELETE may have query params for some operations (like unlink)
    const queryParams: Record<string, string> = {};
    for (const [key, value] of Object.entries(remainingArgs)) {
      if (value !== undefined && value !== null) {
        queryParams[key] = String(value);
      }
    }
    response = await callApi(endpoint, "DELETE", undefined, queryParams);
  } else {
    // POST, PUT - send body
    response = await callApi(
      endpoint,
      tool.method,
      remainingArgs as Record<string, unknown>
    );
  }

  // Format response
  const text = JSON.stringify(response.data, null, 2);

  if (!response.ok) {
    return {
      content: [
        {
          type: "text",
          text: `Error (${response.status}): ${text}`,
        },
      ],
      isError: true,
    };
  }

  return {
    content: [{ type: "text", text }],
  };
}

// ============================================================================
// MCP Server
// ============================================================================

async function main(): Promise<void> {
  // Validate configuration
  if (!NOTES_API_KEY) {
    log("Warning: NOTES_API_KEY not set. API calls may fail.");
  }

  log(`Starting MCP server for ${NOTES_APP_URL}`);

  const server = new Server(
    {
      name: "notes-app",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Handle tool listing
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    log("Listing tools");
    return {
      tools: toMcpTools(),
    };
  });

  // Handle tool execution
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    log(`Executing tool: ${name}`);

    const result = await executeTool(name, (args || {}) as ToolArgs);
    return result;
  });

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);

  log("MCP server running on stdio");
}

// Run
main().catch((error) => {
  log("Fatal error:", error);
  process.exit(1);
});
