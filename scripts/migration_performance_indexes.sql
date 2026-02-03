-- Migration: Performance Indexes for Notes Table
-- Run against your Neon database
-- These indexes optimize the most common queries: filtering by category and sorting by updated_at

-- Index for filtering by user_id and category (used in category filters)
CREATE INDEX IF NOT EXISTS idx_notes_user_category ON notes(user_id, category);

-- Index for sorting by updated_at descending (used in all list queries)
-- Uses COALESCE pattern to handle original_updated_at fallback
CREATE INDEX IF NOT EXISTS idx_notes_user_updated ON notes(user_id, COALESCE(original_updated_at, updated_at) DESC);

-- Index for text search (ILIKE queries on title and content)
-- Using GIN with trigram for faster LIKE/ILIKE searches
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_notes_title_trgm ON notes USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_notes_content_trgm ON notes USING GIN (content gin_trgm_ops);
