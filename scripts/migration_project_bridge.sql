-- Migration: Add external_id and slug columns to projects table
-- Bridges notes DB projects (UUIDs) with swarm canonical IDs (TR-*)

ALTER TABLE projects ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS slug TEXT;

-- Index for lookups by external_id (scoped to user)
CREATE INDEX IF NOT EXISTS idx_projects_external_id
  ON projects(user_id, external_id)
  WHERE external_id IS NOT NULL;
