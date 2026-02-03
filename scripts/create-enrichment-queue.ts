#!/usr/bin/env npx tsx
/**
 * Migration: Create enrichment_queue table
 * Run with: npx tsx scripts/create-enrichment-queue.ts
 */

import { neon } from "@neondatabase/serverless";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

function loadEnv(): Record<string, string> {
  const envPaths = [
    resolve(process.cwd(), ".env.development.local"),
    resolve(process.cwd(), ".env.local"),
  ];

  const env: Record<string, string> = {};

  for (const envPath of envPaths) {
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, "utf-8");
      content.split("\n").forEach((line) => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
          const eqIndex = trimmed.indexOf("=");
          if (eqIndex > 0) {
            const key = trimmed.slice(0, eqIndex).trim();
            let value = trimmed.slice(eqIndex + 1).trim();
            if (
              (value.startsWith('"') && value.endsWith('"')) ||
              (value.startsWith("'") && value.endsWith("'"))
            ) {
              value = value.slice(1, -1);
            }
            value = value.replace(/\\n$/, "").replace(/\\n/g, "\n");
            env[key] = value;
          }
        }
      });
      console.log(`Loaded env from ${envPath}`);
      break;
    }
  }

  return { ...env, ...process.env } as Record<string, string>;
}

async function migrate() {
  const env = loadEnv();
  const DATABASE_URL = env.DATABASE_URL;

  if (!DATABASE_URL) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }

  const sql = neon(DATABASE_URL);

  console.log("Creating enrichment_queue table...\n");

  try {
    // Create the enrichment_queue table
    await sql`
      CREATE TABLE IF NOT EXISTS enrichment_queue (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        user_id UUID NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        priority INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        error TEXT,
        attempts INTEGER DEFAULT 0,
        UNIQUE(note_id)
      )
    `;
    console.log("✓ Created enrichment_queue table");

    // Create index for efficient batch claiming
    await sql`
      CREATE INDEX IF NOT EXISTS idx_enrichment_queue_status
      ON enrichment_queue(status, priority DESC, created_at)
    `;
    console.log("✓ Created status index");

    // Create index for user queries
    await sql`
      CREATE INDEX IF NOT EXISTS idx_enrichment_queue_user
      ON enrichment_queue(user_id, status)
    `;
    console.log("✓ Created user index");

    console.log("\n✅ Migration complete!");
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

migrate();
