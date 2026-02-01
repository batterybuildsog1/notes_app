#!/usr/bin/env node
/**
 * Run migrations against Neon database
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
  console.log("Running migrations...");

  try {
    // Enable pgvector
    console.log("1. Enabling pgvector extension...");
    await sql`CREATE EXTENSION IF NOT EXISTS vector`;
    console.log("   ✓ pgvector enabled");

    // Add embedding column
    console.log("2. Adding embedding column...");
    await sql`ALTER TABLE notes ADD COLUMN IF NOT EXISTS embedding vector(1536)`;
    console.log("   ✓ embedding column added");

    // Add indexed_at column
    console.log("3. Adding indexed_at column...");
    await sql`ALTER TABLE notes ADD COLUMN IF NOT EXISTS indexed_at TIMESTAMP`;
    console.log("   ✓ indexed_at column added");

    // Verify
    console.log("4. Verifying columns...");
    const columns = await sql`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'notes' AND column_name IN ('embedding', 'indexed_at')
    `;
    console.log("   Columns:", columns);

    console.log("\n✅ Migration complete!");
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

migrate();
