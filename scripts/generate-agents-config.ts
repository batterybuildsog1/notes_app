/**
 * Generate src/config/agents.json from OpenClaw config + swarm bindings.
 *
 * Reads:
 *   ~/.openclaw/openclaw.json (agent registry)
 *   ~/agent_swarm/config/agent-project-bindings.json (TR agent → project ID)
 *
 * Writes:
 *   src/config/agents.json
 *
 * Usage: npx tsx scripts/generate-agents-config.ts
 */

import * as fs from "fs";
import * as path from "path";

const HOME = process.env.HOME || "~";
const OPENCLAW_PATH = path.join(HOME, ".openclaw/openclaw.json");
const BINDINGS_PATH = path.join(HOME, "agent_swarm/config/agent-project-bindings.json");
const OUTPUT_PATH = path.join(__dirname, "../src/config/agents.json");

// Map openclaw model aliases → display names
const MODEL_DISPLAY: Record<string, string> = {
  "opus": "opus",
  "gemini-thinking": "gemini-thinking",
  "coder-thinking": "coder-thinking",
  "gemini-3-flash": "gemini-3-flash",
};

// Agent group classification
function classifyGroup(agentId: string): string {
  if (agentId.startsWith("tr-")) return "techridge";
  if (agentId.startsWith("swarm-")) return "swarm";
  const core = ["pm", "notes-pm", "finance", "accounting"];
  if (core.includes(agentId)) return "core";
  return "platform";
}

// Source field convention
function agentSource(agentId: string): string {
  // Special cases
  if (agentId === "pm") return "pm-agent";
  if (agentId === "finance") return "finance-agent";
  return agentId;
}

interface OpenClawAgent {
  model?: string;
  workspace?: string;
  [key: string]: unknown;
}

interface OpenClawConfig {
  agents: Record<string, OpenClawAgent>;
  channels?: {
    telegram?: {
      accounts?: Record<string, { bind?: string }>;
    };
  };
}

interface Binding {
  agentId: string;
  projectId: string;
  scope: string;
}

async function main() {
  // Read openclaw config
  const ocRaw = fs.readFileSync(OPENCLAW_PATH, "utf-8");
  const oc = JSON.parse(ocRaw) as OpenClawConfig;

  // Read project bindings
  let bindings: Binding[] = [];
  try {
    const bRaw = fs.readFileSync(BINDINGS_PATH, "utf-8");
    bindings = JSON.parse(bRaw).bindings as Binding[];
  } catch {
    console.warn("Could not read agent-project-bindings.json, skipping project IDs");
  }

  // Build telegram bot mapping (botName → agentId)
  const telegramMap = new Map<string, string>();
  if (oc.channels?.telegram?.accounts) {
    for (const [botName, config] of Object.entries(oc.channels.telegram.accounts)) {
      if (config.bind) {
        telegramMap.set(config.bind, botName);
      }
    }
  }

  // Build binding map (agentId → projectId)
  const bindingMap = new Map<string, string>();
  for (const b of bindings) {
    if (b.scope === "project") {
      bindingMap.set(b.agentId, b.projectId);
    }
  }

  // Build agent list
  const agents = [];
  for (const [id, config] of Object.entries(oc.agents)) {
    const agent: Record<string, unknown> = {
      id,
      name: id, // Will be overridden by display name mapping
      description: "",
      source: agentSource(id),
      group: classifyGroup(id),
    };

    if (config.model) {
      agent.model = MODEL_DISPLAY[config.model] || config.model;
    }

    const telegramBot = telegramMap.get(id);
    if (telegramBot) {
      agent.telegramBot = telegramBot;
    }

    const projectId = bindingMap.get(id);
    if (projectId) {
      agent.projectId = projectId;
    }

    agents.push(agent);
  }

  // Write output
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(agents, null, 2) + "\n");
  console.log(`Wrote ${agents.length} agents to ${OUTPUT_PATH}`);
  console.log("NOTE: You'll need to manually review display names and descriptions.");
}

main().catch((err) => {
  console.error("Generation failed:", err);
  process.exit(1);
});
