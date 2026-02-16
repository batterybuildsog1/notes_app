-- Migration: Performance indexes for sync + enrichment + entity filters
-- Run with: node scripts/run-migration.mjs migration_sync_enrichment_perf.sql

-- Notion sync lookups
CREATE INDEX IF NOT EXISTS idx_notes_user_notion_page
  ON notes(user_id, notion_page_id)
  WHERE notion_page_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notes_user_unlinked_created
  ON notes(user_id, created_at)
  WHERE notion_page_id IS NULL;

-- Enrichment queue hot paths
CREATE INDEX IF NOT EXISTS idx_enrichment_queue_status_priority_created
  ON enrichment_queue(status, priority DESC, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_enrichment_queue_status_started
  ON enrichment_queue(status, started_at);

-- Entity-filter EXISTS lookups
CREATE INDEX IF NOT EXISTS idx_note_people_person_note
  ON note_people(person_id, note_id);

CREATE INDEX IF NOT EXISTS idx_note_companies_company_note
  ON note_companies(company_id, note_id);

CREATE INDEX IF NOT EXISTS idx_note_projects_project_note
  ON note_projects(project_id, note_id);
