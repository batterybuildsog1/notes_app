# Notes App Fixes - Chronological Ordering & Timestamps

## Problem Statement

All notes currently display with incorrect timestamps:
- **962 Evernote notes**: All show `created_at = 2026-01-30` (import date)
- **73+ Notion notes**: All show `created_at = 2026-02-01` (sync date)
- **Original dates are lost**: Notes should reflect when they were actually created/modified

The actual dates ARE preserved in Evernote note content as metadata:
```
## Metadata
- **Created**: 2023-05-02 17:11
- **Updated**: 2023-05-02 17:19
```

And Notion provides `created_time` and `last_edited_time` in API responses.

---

## Fixes Required

### 1. Database Schema Changes

Add columns to preserve original timestamps separately from system timestamps:

```sql
-- Original timestamps from source (Evernote/Notion/manual entry)
ALTER TABLE notes ADD COLUMN IF NOT EXISTS original_created_at TIMESTAMPTZ;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS original_updated_at TIMESTAMPTZ;

-- Index for chronological queries
CREATE INDEX IF NOT EXISTS idx_notes_original_created 
ON notes(user_id, COALESCE(original_created_at, created_at) DESC);
```

**Rationale**: Keep `created_at`/`updated_at` as system timestamps (when record was created/modified in DB), but add `original_created_at`/`original_updated_at` for display and sorting.

---

### 2. Backfill Evernote Notes

Create a migration script to extract dates from note content:

```javascript
// scripts/backfill-evernote-dates.mjs

// Regex patterns for Evernote metadata
const CREATED_PATTERN = /\*\*Created\*\*:\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/;
const UPDATED_PATTERN = /\*\*Updated\*\*:\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/;

// For each note where source = 'evernote':
// 1. Parse content for Created/Updated dates
// 2. Convert to timestamps (assume Mountain Time or UTC)
// 3. Update original_created_at and original_updated_at
// 4. Optionally strip metadata section from content (clean display)
```

**Edge cases to handle**:
- Notes without metadata section
- Malformed dates
- Timezone handling (Evernote exports in local time)

---

### 3. Fix Notion Sync

Modify `/src/lib/notion-sync.ts` and `/src/app/api/sync/notion/route.ts`:

**Current (broken)**:
```javascript
// Creates note with NOW() as timestamp
const rows = await sql`
  INSERT INTO notes (..., created_at, updated_at)
  VALUES (..., NOW(), NOW())
`;
```

**Fixed**:
```javascript
// Use Notion's actual timestamps
const notionCreated = new Date(page.created_time);
const notionEdited = new Date(page.last_edited_time);

const rows = await sql`
  INSERT INTO notes (
    ..., 
    created_at, 
    updated_at,
    original_created_at,
    original_updated_at
  )
  VALUES (
    ..., 
    NOW(),  -- system timestamp
    NOW(),  -- system timestamp
    ${notionCreated.toISOString()},  -- original from Notion
    ${notionEdited.toISOString()}    -- original from Notion
  )
`;
```

**For updates** (existing notes re-synced):
```javascript
// Only update original_updated_at, preserve original_created_at
await sql`
  UPDATE notes 
  SET content = ${content},
      updated_at = NOW(),
      original_updated_at = ${notionEdited.toISOString()},
      notion_last_edited = ${page.last_edited_time}
  WHERE id = ${existing.id}
`;
```

---

### 4. Update API Responses

Modify `/src/lib/db.ts` - `getNotes()` function:

**Current**:
```javascript
const rows = await sql`
  SELECT * FROM notes 
  WHERE user_id = ${userId} 
  ORDER BY updated_at DESC
`;
```

**Fixed**:
```javascript
const rows = await sql`
  SELECT *,
    COALESCE(original_created_at, created_at) as display_created_at,
    COALESCE(original_updated_at, updated_at) as display_updated_at
  FROM notes 
  WHERE user_id = ${userId} 
  ORDER BY COALESCE(original_updated_at, updated_at) DESC
`;
```

---

### 5. Update TypeScript Interface

Modify `/src/lib/db.ts`:

```typescript
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
  original_created_at: Date | null;  // NEW: From source
  original_updated_at: Date | null;  // NEW: From source
  display_created_at?: Date;  // NEW: For UI (coalesced)
  display_updated_at?: Date;  // NEW: For UI (coalesced)
  notion_page_id: string | null;
  notion_last_edited: Date | null;
}
```

---

### 6. Update Frontend Display

Modify `/src/components/notes/notes-list.tsx` (or equivalent):

```typescript
// Use display dates for UI
const displayDate = note.display_updated_at || note.updated_at;

// Format for display
function formatNoteDate(date: Date): string {
  const now = new Date();
  const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric', 
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined 
  });
}
```

---

### 7. Allow Manual Date Editing

Add to note editor (`/src/components/notes/note-editor.tsx`):

```typescript
// Add date picker for original_created_at
<DatePicker
  label="Created Date"
  value={note.original_created_at || note.created_at}
  onChange={(date) => updateNote({ original_created_at: date })}
/>
```

This allows users to manually correct dates for notes where automatic extraction failed.

---

### 8. Push to Notion with Correct Dates

When pushing notes FROM notes-app TO Notion, Notion doesn't allow setting `created_time` directly (it's system-controlled). However, we can:

1. Add a "Created" property to pushed pages as a date field
2. Or include creation date in the page content header

```javascript
// When creating Notion page
const body = {
  parent: { page_id: parentId },
  properties: {
    title: { title: [{ text: { content: title } }] },
  },
  children: [
    {
      object: "block",
      type: "callout",
      callout: {
        rich_text: [{ 
          text: { 
            content: `Originally created: ${originalCreated.toISOString().split('T')[0]}` 
          } 
        }],
        icon: { emoji: "📅" }
      }
    },
    // ... rest of content
  ]
};
```

---

## Implementation Order

1. **Schema migration** - Add columns (non-breaking)
2. **Backfill Evernote** - Parse and populate original dates
3. **Fix Notion sync** - Use Notion timestamps going forward
4. **Update queries** - Sort by original dates
5. **Update API/types** - Return display dates
6. **Update frontend** - Show correct dates
7. **Add date editor** - Manual correction capability
8. **Fix Notion push** - Include dates in content

---

## Testing Checklist

- [ ] New notes created in app have correct timestamps
- [ ] Evernote notes show original creation dates
- [ ] Notion-synced notes show Notion's creation dates
- [ ] Notes sort chronologically by actual date
- [ ] Manual date editing works
- [ ] Dates display correctly in different timezones
- [ ] Search still works with new columns

---

## Files to Modify

| File | Changes |
|------|---------|
| `scripts/migration_fix_timestamps.sql` | New - schema changes |
| `scripts/backfill-evernote-dates.mjs` | New - extract dates from content |
| `src/lib/db.ts` | Update Note interface, query ordering |
| `src/lib/notion-sync.ts` | Use Notion timestamps |
| `src/app/api/sync/notion/route.ts` | Pass timestamps correctly |
| `src/app/api/notes/route.ts` | Return display dates |
| `src/components/notes/note-editor.tsx` | Add date picker |
| `src/components/notes/notes-list.tsx` | Display correct dates |

---

## Notes

- Timezone: Assume Evernote exports used Mountain Time (America/Denver)
- Notion uses UTC in API responses
- Keep system timestamps for audit trail
- Original dates should be immutable once set (unless manually edited)
