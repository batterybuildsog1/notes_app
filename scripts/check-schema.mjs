#!/usr/bin/env node
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";

const envContent = readFileSync(".env.local", "utf-8");
const envVars = {};
envContent.split("\n").forEach((line) => {
  const [key, ...valueParts] = line.split("=");
  if (key && valueParts.length) {
    envVars[key.trim()] = valueParts.join("=").trim();
  }
});

const sql = neon(envVars.DATABASE_URL);

async function check() {
  console.log("=== NOTES TABLE SCHEMA ===");
  const schema = await sql`
    SELECT column_name, data_type, is_nullable 
    FROM information_schema.columns 
    WHERE table_name = 'notes'
    ORDER BY ordinal_position
  `;
  schema.forEach(col => console.log(`  ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`));

  console.log("\n=== FULL NOTE SAMPLE ===");
  const sample = await sql`SELECT * FROM notes LIMIT 1`;
  console.log(JSON.stringify(sample[0], null, 2));
}

check().catch(console.error);
