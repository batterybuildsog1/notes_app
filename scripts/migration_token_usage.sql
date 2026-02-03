-- Migration: Token Usage Tracking
-- Tracks API token consumption and costs for Grok, OpenAI, etc.
-- Run against your Neon database

CREATE TABLE IF NOT EXISTS token_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMP DEFAULT NOW(),
  model TEXT NOT NULL,           -- 'grok-4-1-fast-reasoning', 'text-embedding-3-small', etc.
  operation TEXT NOT NULL,       -- 'enrich', 'clarify', 'embed', 'suggest', 'extract-entities'
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_usd DECIMAL(10, 6) NOT NULL,
  note_id UUID,                  -- optional, for tracking per-note costs
  user_id TEXT,                  -- optional, for tracking per-user costs
  metadata JSONB                 -- additional context (prompt length, response length, etc.)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_token_usage_timestamp ON token_usage(timestamp);
CREATE INDEX IF NOT EXISTS idx_token_usage_operation ON token_usage(operation);
CREATE INDEX IF NOT EXISTS idx_token_usage_model ON token_usage(model);
CREATE INDEX IF NOT EXISTS idx_token_usage_note_id ON token_usage(note_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_user_id ON token_usage(user_id);

-- Composite index for daily/monthly aggregations
CREATE INDEX IF NOT EXISTS idx_token_usage_date_op ON token_usage(DATE(timestamp), operation);
CREATE INDEX IF NOT EXISTS idx_token_usage_date_model ON token_usage(DATE(timestamp), model);
