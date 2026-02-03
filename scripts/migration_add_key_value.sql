-- Migration: Key-Value table for storing configuration
-- Used for tracking Telegram last update_id for polling

CREATE TABLE IF NOT EXISTS key_value (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Add index for telegram clarification lookups by message_id
CREATE INDEX IF NOT EXISTS idx_clarifications_telegram_msg_id
  ON clarifications(telegram_message_id)
  WHERE telegram_message_id IS NOT NULL;
