-- Migration: Add original timestamp columns for chronological ordering
-- Fixes the issue where all imported notes show the same date

-- Add original timestamps from source (Evernote/Notion/manual entry)
ALTER TABLE notes ADD COLUMN IF NOT EXISTS original_created_at TIMESTAMPTZ;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS original_updated_at TIMESTAMPTZ;

-- Index for chronological queries using COALESCE
CREATE INDEX IF NOT EXISTS idx_notes_original_created 
ON notes(user_id, COALESCE(original_created_at, created_at) DESC);

-- Index for finding notes needing backfill
CREATE INDEX IF NOT EXISTS idx_notes_source_no_original 
ON notes(source) WHERE original_created_at IS NULL;
