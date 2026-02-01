-- Migration: Add pgvector extension and embedding column
-- Run this in Neon SQL Editor

-- 1. Enable pgvector extension (Neon has this pre-installed)
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Add embedding column if it doesn't exist
-- Using 1536 dimensions for text-embedding-3-small
ALTER TABLE notes ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- 3. Add indexed_at timestamp for tracking when embedding was generated
ALTER TABLE notes ADD COLUMN IF NOT EXISTS indexed_at TIMESTAMP;

-- 4. Create index for fast similarity search (IVFFlat)
-- Only create if we have enough notes (skip for now, add later when > 1000 notes)
-- CREATE INDEX IF NOT EXISTS notes_embedding_idx ON notes USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- 5. Verify
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'notes' AND column_name IN ('embedding', 'indexed_at');
