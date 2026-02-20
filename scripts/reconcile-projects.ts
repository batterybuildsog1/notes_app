/**
 * Reconcile swarm project-map.json with notes DB projects.
 *
 * For each swarm project, finds a matching notes DB project by normalized name
 * and sets external_id + slug. Creates missing projects if needed.
 *
 * Usage: npx tsx scripts/reconcile-projects.ts [--dry-run]
 *
 * Requires: DATABASE_URL and SERVICE_USER_ID env vars
 */

import { neon } from "@neondatabase/serverless";
import * as fs from "fs";
import * as path from "path";

const PROJECT_MAP_PATH = path.join(
  process.env.HOME || "~",
  "agent_swarm/config/project-map.json"
);

const dryRun = process.argv.includes("--dry-run");

interface SwarmProject {
  id: string;
  slug: string;
  name: string;
  status: string;
}

interface DBProject {
  id: string;
  name: string;
  normalized_name: string;
  external_id: string | null;
  slug: string | null;
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }
  const userId = process.env.SERVICE_USER_ID;
  if (!userId) {
    console.error("SERVICE_USER_ID not set");
    process.exit(1);
  }

  const sql = neon(databaseUrl);

  // Read swarm project map
  const raw = fs.readFileSync(PROJECT_MAP_PATH, "utf-8");
  const { projects: swarmProjects } = JSON.parse(raw) as { projects: SwarmProject[] };
  console.log(`Loaded ${swarmProjects.length} swarm projects from ${PROJECT_MAP_PATH}`);

  // Get existing DB projects
  const dbProjects = (await sql`
    SELECT id, name, normalized_name, external_id, slug
    FROM projects WHERE user_id = ${userId}
  `) as DBProject[];
  console.log(`Found ${dbProjects.length} existing DB projects`);

  let matched = 0;
  let created = 0;
  let skipped = 0;

  for (const swarm of swarmProjects) {
    // Already reconciled?
    const alreadyLinked = dbProjects.find((p) => p.external_id === swarm.id);
    if (alreadyLinked) {
      console.log(`  [SKIP] ${swarm.name} (${swarm.id}) already linked to ${alreadyLinked.id}`);
      skipped++;
      continue;
    }

    // Try to match by normalized name
    const swarmNormalized = normalizeName(swarm.name);
    const match = dbProjects.find((p) => {
      const dbNorm = p.normalized_name || normalizeName(p.name);
      return dbNorm === swarmNormalized;
    });

    if (match) {
      console.log(`  [MATCH] ${swarm.name} (${swarm.id}) → DB project "${match.name}" (${match.id})`);
      if (!dryRun) {
        await sql`
          UPDATE projects SET external_id = ${swarm.id}, slug = ${swarm.slug}
          WHERE id = ${match.id}
        `;
      }
      matched++;
    } else {
      console.log(`  [CREATE] ${swarm.name} (${swarm.id}) — no match found, creating`);
      if (!dryRun) {
        await sql`
          INSERT INTO projects (user_id, name, normalized_name, external_id, slug)
          VALUES (${userId}, ${swarm.name}, ${swarmNormalized}, ${swarm.id}, ${swarm.slug})
          ON CONFLICT (user_id, normalized_name) DO UPDATE
          SET external_id = EXCLUDED.external_id, slug = EXCLUDED.slug
        `;
      }
      created++;
    }
  }

  console.log(`\nDone${dryRun ? " (DRY RUN)" : ""}:`);
  console.log(`  Matched: ${matched}`);
  console.log(`  Created: ${created}`);
  console.log(`  Skipped (already linked): ${skipped}`);
}

main().catch((err) => {
  console.error("Reconciliation failed:", err);
  process.exit(1);
});
