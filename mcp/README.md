# Notes App MCP Server

Model Context Protocol tools for Grok to operate the notes-app.

## Setup

1. Set environment variables:
   ```bash
   export NOTES_APP_URL="https://your-app.vercel.app"  # or localhost:3000
   export NOTES_API_KEY="your-api-key"
   ```

2. The API key should match one configured in `SERVICE_API_KEYS` on the server.

## Authentication

All requests require the `X-API-Key` header with a valid service API key.

## Available Tools

### Note Operations

| Tool | Description |
|------|-------------|
| `create_note` | Create a new note with auto-enrichment |
| `update_note` | Update an existing note |
| `delete_note` | Delete a note |
| `get_note` | Get a single note with linked entities |
| `search_notes` | Search by text, category, or entity |
| `semantic_search` | AI-powered semantic similarity search |
| `split_note` | Split one note into multiple |
| `merge_notes` | Merge multiple notes into one |
| `clarify_note` | Add context to vague notes |

### Entity Operations (CRM-style)

| Tool | Description |
|------|-------------|
| `list_people` | List all people with note counts |
| `create_person` | Manually create a person |
| `list_companies` | List all companies with note counts |
| `create_company` | Manually create a company |
| `list_projects` | List all projects with note counts |
| `create_project` | Manually create a project |
| `link_to_entity` | Link note to person/company/project |
| `unlink_from_entity` | Remove entity link from note |

### Other

| Tool | Description |
|------|-------------|
| `get_pending_clarifications` | Notes needing more context |
| `get_stats` | Database statistics |

## Common Workflows

### Creating a Rich Note

```json
// create_note
{
  "title": "Meeting with John about 123 Maple St",
  "content": "Discussed refinancing with John Smith from ABC Bank. Property inspection scheduled for next week.",
  "category": "real-estate",
  "tags": ["refinance", "inspection"]
}
```

The system will automatically:
- Extract entities (John Smith as person, ABC Bank as company)
- Link entities to the note
- Generate embeddings for semantic search

### Finding Related Notes

```json
// semantic_search
{
  "query": "bank meetings about property financing",
  "limit": 5
}
```

### Getting All Notes for a Person

```json
// 1. First, list people to get ID
// list_people
{}

// 2. Then search notes filtered by person
// search_notes
{
  "person": "uuid-from-step-1"
}
```

### Splitting a Long Note

```json
// split_note
{
  "noteId": "note-uuid",
  "splits": [
    {"title": "Financing Details", "content": "First part..."},
    {"title": "Inspection Notes", "content": "Second part..."}
  ],
  "deleteOriginal": true
}
```

### Merging Related Notes

```json
// merge_notes
{
  "noteIds": ["note-1-uuid", "note-2-uuid", "note-3-uuid"],
  "newTitle": "Combined: Maple St Project Notes"
}
```

## Rate Limits

- GET operations: 100/minute
- POST/PUT operations: 30/minute
- Split/Merge: 10/minute

## Response Format

All endpoints return JSON. Successful responses include the requested data.
Error responses have format:
```json
{
  "error": "Error message"
}
```

HTTP status codes:
- 200: Success
- 201: Created
- 400: Bad request (invalid input)
- 401: Unauthorized
- 404: Not found
- 429: Rate limited
- 500: Server error
