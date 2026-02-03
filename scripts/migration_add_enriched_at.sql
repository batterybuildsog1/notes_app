-- Migration: Add enriched_at column for tracking entity enrichment
-- Run this on your Neon database

-- Add enriched_at column if it doesn't exist
ALTER TABLE notes ADD COLUMN IF NOT EXISTS enriched_at TIMESTAMP;

-- Create index for efficient queries of unenriched notes
CREATE INDEX IF NOT EXISTS idx_notes_enriched_at ON notes (enriched_at)
WHERE enriched_at IS NULL;

-- Verify the column was added
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'notes' AND column_name = 'enriched_at';
