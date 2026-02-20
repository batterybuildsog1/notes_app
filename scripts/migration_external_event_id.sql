-- Migration: Add external_event_id to notes table
-- Enables swarm artifacts to be written as notes with deduplication

ALTER TABLE notes ADD COLUMN IF NOT EXISTS external_event_id TEXT;

-- Unique index for upsert deduplication (scoped to user)
CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_external_event
  ON notes(user_id, external_event_id)
  WHERE external_event_id IS NOT NULL;
