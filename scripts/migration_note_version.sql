-- Migration: Add version column for optimistic concurrency control
-- Prevents silent data loss from concurrent edits

-- Add version column with default 1
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notes' AND column_name = 'version'
  ) THEN
    ALTER TABLE notes ADD COLUMN version integer NOT NULL DEFAULT 1;
  END IF;
END $$;
