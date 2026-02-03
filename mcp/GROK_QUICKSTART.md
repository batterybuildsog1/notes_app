# Notes App API - Grok Quickstart

Direct HTTP API reference for AI agent integration.

## Authentication

```bash
# All requests require X-API-Key header
-H "X-API-Key: $NOTES_API_KEY"
```

The API key is set in `SERVICE_API_KEYS` env var on Vercel.

## Base URL

```
https://notes.sunhomes.io
```

## Endpoints Reference

### Notes CRUD

**Create note**
```bash
curl -X POST https://notes.sunhomes.io/api/notes \
  -H "X-API-Key: $NOTES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"title":"Meeting notes","content":"Discussed project timeline with John Smith from ABC Corp"}'
```

**Get note**
```bash
curl https://notes.sunhomes.io/api/notes/{id} \
  -H "X-API-Key: $NOTES_API_KEY"
```

**Update note**
```bash
curl -X PUT https://notes.sunhomes.io/api/notes/{id} \
  -H "X-API-Key: $NOTES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"title":"Updated title","tags":["important","follow-up"]}'
```

**Delete note**
```bash
curl -X DELETE https://notes.sunhomes.io/api/notes/{id} \
  -H "X-API-Key: $NOTES_API_KEY"
```

**List/search notes**
```bash
# All notes
curl "https://notes.sunhomes.io/api/notes" -H "X-API-Key: $NOTES_API_KEY"

# With filters
curl "https://notes.sunhomes.io/api/notes?search=refinance&category=real-estate" \
  -H "X-API-Key: $NOTES_API_KEY"

# Filter by linked entity
curl "https://notes.sunhomes.io/api/notes?person={personId}" -H "X-API-Key: $NOTES_API_KEY"
```

### Semantic Search

```bash
curl -X POST https://notes.sunhomes.io/api/notes/semantic-search \
  -H "X-API-Key: $NOTES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"properties needing renovation","limit":5}'
```

### Split & Merge

**Split note**
```bash
curl -X POST https://notes.sunhomes.io/api/notes/split \
  -H "X-API-Key: $NOTES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "noteId": "{id}",
    "splits": [
      {"title":"Part 1","content":"First part content"},
      {"title":"Part 2","content":"Second part content"}
    ],
    "deleteOriginal": true
  }'
```

**Merge notes**
```bash
curl -X POST https://notes.sunhomes.io/api/notes/merge \
  -H "X-API-Key: $NOTES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "noteIds": ["{id1}", "{id2}"],
    "newTitle": "Combined notes"
  }'
```

### Entity Linking

**Link note to entity**
```bash
# By name (creates entity if needed)
curl -X POST https://notes.sunhomes.io/api/notes/{noteId}/link \
  -H "X-API-Key: $NOTES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"type":"person","name":"John Smith"}'

# By ID
curl -X POST https://notes.sunhomes.io/api/notes/{noteId}/link \
  -H "X-API-Key: $NOTES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"type":"company","entityId":"{companyId}"}'
```

**Unlink entity**
```bash
curl -X DELETE "https://notes.sunhomes.io/api/notes/{noteId}/link?type=person&entityId={personId}" \
  -H "X-API-Key: $NOTES_API_KEY"
```

### Entity Lists

```bash
# People
curl https://notes.sunhomes.io/api/people -H "X-API-Key: $NOTES_API_KEY"

# Companies
curl https://notes.sunhomes.io/api/companies -H "X-API-Key: $NOTES_API_KEY"

# Projects
curl https://notes.sunhomes.io/api/projects -H "X-API-Key: $NOTES_API_KEY"
```

**Create entity manually**
```bash
curl -X POST https://notes.sunhomes.io/api/people \
  -H "X-API-Key: $NOTES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"Jane Doe"}'
```

### Clarification

**Get pending clarifications**
```bash
curl https://notes.sunhomes.io/api/notes/clarify -H "X-API-Key: $NOTES_API_KEY"
```

**Provide clarification**
```bash
curl -X POST https://notes.sunhomes.io/api/notes/clarify \
  -H "X-API-Key: $NOTES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"noteId":"{id}","context":"John is John Smith from ABC Bank"}'
```

### Project Suggestions

```bash
curl https://notes.sunhomes.io/api/notes/{noteId}/suggest-projects \
  -H "X-API-Key: $NOTES_API_KEY"
```

### Categories

```bash
curl https://notes.sunhomes.io/api/categories -H "X-API-Key: $NOTES_API_KEY"
```

### Templates

**List templates**
```bash
curl https://notes.sunhomes.io/api/templates -H "X-API-Key: $NOTES_API_KEY"
```

**Create template**
```bash
curl -X POST https://notes.sunhomes.io/api/templates \
  -H "X-API-Key: $NOTES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Meeting Notes",
    "title_template": "Meeting: {{topic}}",
    "content_template": "Date: {{date}}\nAttendees:\n\nAgenda:\n\nNotes:\n\nAction Items:",
    "default_category": "meetings",
    "default_tags": ["meeting"]
  }'
```

**Delete template**
```bash
curl -X DELETE "https://notes.sunhomes.io/api/templates?id={templateId}" \
  -H "X-API-Key: $NOTES_API_KEY"
```

### Stats & Usage

**Database stats**
```bash
curl https://notes.sunhomes.io/api/notes/stats -H "X-API-Key: $NOTES_API_KEY"
```

**Token usage**
```bash
# Today's usage
curl https://notes.sunhomes.io/api/usage -H "X-API-Key: $NOTES_API_KEY"

# By period: today, week, month, all
curl "https://notes.sunhomes.io/api/usage?period=month" -H "X-API-Key: $NOTES_API_KEY"

# For specific note
curl "https://notes.sunhomes.io/api/usage?noteId={id}" -H "X-API-Key: $NOTES_API_KEY"
```

### Issues Report

**Get system issues** (data quality, enrichment problems)
```bash
curl https://notes.sunhomes.io/api/issues -H "X-API-Key: $NOTES_API_KEY"
```
Returns: notes without categories/tags/embeddings, stalled enrichment, pending clarifications, duplicate entities.

### Health Check

**Check API status** (no auth required)
```bash
curl https://notes.sunhomes.io/api/health
```

## Common Workflows

### 1. Quick note capture
```bash
curl -X POST https://notes.sunhomes.io/api/notes \
  -H "X-API-Key: $NOTES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"title":"Call with Bob","content":"Bob Miller called about 456 Oak Ave. Wants to close by March 15."}'
# Note auto-enriches: extracts Bob Miller (person) and 456 Oak Ave (property)
```

### 2. Find related notes
```bash
# Keyword search
curl "https://notes.sunhomes.io/api/notes?search=closing" -H "X-API-Key: $NOTES_API_KEY"

# Semantic search (finds conceptually similar)
curl -X POST https://notes.sunhomes.io/api/notes/semantic-search \
  -H "X-API-Key: $NOTES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"deals about to close"}'
```

### 3. Build entity context
```bash
# Get all notes for a person
PERSON_ID=$(curl -s https://notes.sunhomes.io/api/people -H "X-API-Key: $NOTES_API_KEY" | jq -r '.[] | select(.name=="Bob Miller") | .id')
curl "https://notes.sunhomes.io/api/notes?person=$PERSON_ID" -H "X-API-Key: $NOTES_API_KEY"
```

### 4. Link existing note to project
```bash
# Check suggestions first
curl https://notes.sunhomes.io/api/notes/{noteId}/suggest-projects -H "X-API-Key: $NOTES_API_KEY"

# Then link
curl -X POST https://notes.sunhomes.io/api/notes/{noteId}/link \
  -H "X-API-Key: $NOTES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"type":"project","name":"Oak Avenue Flip"}'
```

## Error Handling

| Status | Meaning | Action |
|--------|---------|--------|
| 401 | Invalid/missing API key | Check X-API-Key header |
| 400 | Invalid request body | Check JSON format, required fields |
| 404 | Resource not found | Verify ID exists |
| 500 | Server error | Retry with exponential backoff |

**Response format on error:**
```json
{"error": "Description of what went wrong"}
```

## Rate Limits

No explicit rate limits, but semantic search and enrichment use OpenAI tokens. Check usage with `/api/usage` endpoint.

## Field Reference

### Note object
```json
{
  "id": "uuid",
  "title": "string (max 500)",
  "content": "string (max 100000)",
  "category": "string",
  "tags": ["array", "of", "strings"],
  "priority": "low|medium|high",
  "project": "string",
  "created_at": "ISO timestamp",
  "updated_at": "ISO timestamp",
  "enriched_at": "ISO timestamp or null",
  "entities": {
    "people": [{"id": "uuid", "name": "string"}],
    "companies": [{"id": "uuid", "name": "string", "type": "string"}],
    "projects": [{"id": "uuid", "name": "string"}]
  }
}
```

### Entity types for linking
- `person` - Individual contacts
- `company` - Organizations, banks, contractors, vendors
- `project` - Deals, developments, initiatives
