-- Migration: Add note_type column + tsvector full-text search
-- Run via Neon console or psql

-- Phase 0: note_type column
ALTER TABLE notes ADD COLUMN IF NOT EXISTS note_type TEXT;
CREATE INDEX IF NOT EXISTS idx_notes_note_type ON notes(note_type) WHERE note_type IS NOT NULL;
COMMENT ON COLUMN notes.note_type IS 'meeting-note, conversation, receipt, credential, task, document, contact, research, journal, decision, reference, update';

-- Phase 1: Full-text search vector
ALTER TABLE notes ADD COLUMN IF NOT EXISTS search_vector tsvector;
CREATE INDEX IF NOT EXISTS idx_notes_search_vector ON notes USING gin(search_vector);

-- Backfill search_vector for existing notes
UPDATE notes SET search_vector =
  setweight(to_tsvector('english', COALESCE(title, '')), 'A') ||
  setweight(to_tsvector('english', COALESCE(content, '')), 'B') ||
  setweight(to_tsvector('english', COALESCE(array_to_string(tags, ' '), '')), 'C')
WHERE search_vector IS NULL;

-- Auto-update trigger
CREATE OR REPLACE FUNCTION notes_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.content, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(array_to_string(NEW.tags, ' '), '')), 'C');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS notes_search_vector_trigger ON notes;
CREATE TRIGGER notes_search_vector_trigger
  BEFORE INSERT OR UPDATE OF title, content, tags ON notes
  FOR EACH ROW EXECUTE FUNCTION notes_search_vector_update();
