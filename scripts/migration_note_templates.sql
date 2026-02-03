-- Migration: Add note_templates table for reusable note templates
-- Run this on your Neon database

-- Create templates table
CREATE TABLE IF NOT EXISTS note_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  title_template TEXT,
  content_template TEXT,
  default_category TEXT,
  default_tags TEXT[],
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create index for user lookups
CREATE INDEX IF NOT EXISTS idx_note_templates_user_id ON note_templates (user_id);

-- Create unique constraint on user_id + name to prevent duplicate template names
CREATE UNIQUE INDEX IF NOT EXISTS idx_note_templates_user_name ON note_templates (user_id, name);

-- Verify the table was created
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_name = 'note_templates'
ORDER BY ordinal_position;
