#!/usr/bin/env node
/**
 * Run performance indexes migration against Neon database
 */

import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";

// Load .env.local manually
const envContent = readFileSync(".env.local", "utf-8");
const envVars = {};
envContent.split("\n").forEach((line) => {
  const [key, ...valueParts] = line.split("=");
  if (key && valueParts.length) {
    envVars[key.trim()] = valueParts.join("=").trim();
  }
});

const DATABASE_URL = envVars.DATABASE_URL || process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set in .env.local");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function migrate() {
  console.log("Running performance indexes migration...\n");

  try {
    // 1. Index for user_id + category
    console.log("1. Creating idx_notes_user_category...");
    await sql`CREATE INDEX IF NOT EXISTS idx_notes_user_category ON notes(user_id, category)`;
    console.log("   ✓ idx_notes_user_category created");

    // 2. Index for sorting by updated_at
    console.log("2. Creating idx_notes_user_updated...");
    await sql`CREATE INDEX IF NOT EXISTS idx_notes_user_updated ON notes(user_id, COALESCE(original_updated_at, updated_at) DESC)`;
    console.log("   ✓ idx_notes_user_updated created");

    // 3. Enable pg_trgm for text search
    console.log("3. Enabling pg_trgm extension...");
    await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`;
    console.log("   ✓ pg_trgm enabled");

    // 4. Trigram index for title search
    console.log("4. Creating idx_notes_title_trgm...");
    await sql`CREATE INDEX IF NOT EXISTS idx_notes_title_trgm ON notes USING GIN (title gin_trgm_ops)`;
    console.log("   ✓ idx_notes_title_trgm created");

    // 5. Trigram index for content search
    console.log("5. Creating idx_notes_content_trgm...");
    await sql`CREATE INDEX IF NOT EXISTS idx_notes_content_trgm ON notes USING GIN (content gin_trgm_ops)`;
    console.log("   ✓ idx_notes_content_trgm created");

    // Verify indexes
    console.log("\n6. Verifying indexes...");
    const indexes = await sql`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'notes'
      AND indexname LIKE 'idx_notes_%'
    `;
    console.log("   Created indexes:");
    for (const idx of indexes) {
      console.log(`   - ${idx.indexname}`);
    }

    console.log("\n✅ Performance indexes migration complete!");
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

migrate();
