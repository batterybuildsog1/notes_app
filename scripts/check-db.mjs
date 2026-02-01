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
  console.log("=== USERS ===");
  const users = await sql`SELECT id, email, name FROM "user"`;
  console.log(users);

  console.log("\n=== NOTES COUNT BY USER ===");
  const notesByUser = await sql`SELECT user_id, COUNT(*) as count FROM notes GROUP BY user_id`;
  console.log(notesByUser);

  console.log("\n=== TOTAL NOTES ===");
  const total = await sql`SELECT COUNT(*) as count FROM notes`;
  console.log(total);

  console.log("\n=== SAMPLE NOTES (first 5) ===");
  const sample = await sql`SELECT id, title, user_id, category FROM notes LIMIT 5`;
  console.log(sample);

  console.log("\n=== SERVICE_USER_ID in env ===");
  console.log(envVars.SERVICE_USER_ID || "NOT SET");
}

check().catch(console.error);
