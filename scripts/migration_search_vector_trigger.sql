-- Migration: Auto-maintain search_vector on notes insert/update
-- This ensures the tsvector column stays in sync with title and content
-- so keyword search always returns up-to-date results.

-- First ensure the search_vector column exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notes' AND column_name = 'search_vector'
  ) THEN
    ALTER TABLE notes ADD COLUMN search_vector tsvector;
  END IF;
END $$;

-- Create or replace the trigger function
CREATE OR REPLACE FUNCTION notes_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.content, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if any, then create
DROP TRIGGER IF EXISTS trg_notes_search_vector ON notes;
CREATE TRIGGER trg_notes_search_vector
  BEFORE INSERT OR UPDATE OF title, content ON notes
  FOR EACH ROW
  EXECUTE FUNCTION notes_search_vector_update();

-- Backfill existing notes that have NULL search_vector
UPDATE notes
SET search_vector =
  setweight(to_tsvector('english', COALESCE(title, '')), 'A') ||
  setweight(to_tsvector('english', COALESCE(content, '')), 'B')
WHERE search_vector IS NULL;

-- Index for fast full-text search
CREATE INDEX IF NOT EXISTS idx_notes_search_vector ON notes USING gin(search_vector);
