-- Migration: Add Notion sync support
-- Run with: node scripts/run-migration.mjs migration_add_notion_sync.sql

-- Add notion_page_id to track which Notion page a note is linked to
ALTER TABLE notes ADD COLUMN IF NOT EXISTS notion_page_id TEXT;

-- Add notion_last_edited to track when the Notion page was last modified
-- (helps with conflict resolution)
ALTER TABLE notes ADD COLUMN IF NOT EXISTS notion_last_edited TIMESTAMPTZ;

-- Create sync state table to track sync progress
CREATE TABLE IF NOT EXISTS notion_sync_state (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  last_pull_at TIMESTAMPTZ,
  last_push_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Index for fast lookups by notion_page_id
CREATE INDEX IF NOT EXISTS idx_notes_notion_page_id ON notes(notion_page_id) WHERE notion_page_id IS NOT NULL;

-- Index for finding notes to push (no notion_page_id)
CREATE INDEX IF NOT EXISTS idx_notes_no_notion ON notes(user_id, created_at) WHERE notion_page_id IS NULL;
