-- Migration: Sync run logging for Notion sync reliability
-- Run with: node scripts/run-migration.mjs migration_sync_runs.sql

CREATE TABLE IF NOT EXISTS sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'notion',
  direction TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  pulled_count INTEGER NOT NULL DEFAULT 0,
  pushed_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  error_sample JSONB,
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_user_started
  ON sync_runs(user_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_runs_provider_status
  ON sync_runs(provider, status, started_at DESC);
