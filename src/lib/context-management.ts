/**
 * Context Management for AI Sessions
 *
 * Provides guidelines and utilities for managing AI context windows,
 * determining when to rotate context, and creating handoff summaries.
 */

// Context limits for determining when to start fresh
export const CONTEXT_LIMITS = {
  // Maximum tool calls before suggesting context rotation
  maxToolCalls: 50,

  // Maximum tokens processed before suggesting context rotation
  maxTokensProcessed: 100000,

  // Maximum idle time in minutes before suggesting fresh start
  maxIdleMinutes: 30,

  // Maximum conversation turns before suggesting rotation
  maxConversationTurns: 100,

  // Warning thresholds (percentage of max)
  warningThreshold: 0.8,
};

// Session statistics interface
export interface SessionStats {
  toolCalls: number;
  tokensProcessed: number;
  lastActivityAt: Date;
  conversationTurns: number;
  startedAt: Date;
}

// Context state interface
export interface ContextState {
  currentTask?: string;
  completedTasks: string[];
  pendingTasks: string[];
  activeFiles: string[];
  recentDecisions: Array<{ decision: string; rationale: string }>;
  errors: string[];
  notes: string[];
}

/**
 * Check if context should be rotated based on session stats
 */
export function shouldRotateContext(stats: SessionStats): {
  shouldRotate: boolean;
  reason: string | null;
  warnings: string[];
} {
  const now = new Date();
  const idleMinutes = (now.getTime() - stats.lastActivityAt.getTime()) / 60000;
  const warnings: string[] = [];

  // Check each limit
  if (stats.toolCalls >= CONTEXT_LIMITS.maxToolCalls) {
    return {
      shouldRotate: true,
      reason: `Tool call limit reached (${stats.toolCalls}/${CONTEXT_LIMITS.maxToolCalls})`,
      warnings,
    };
  }

  if (stats.tokensProcessed >= CONTEXT_LIMITS.maxTokensProcessed) {
    return {
      shouldRotate: true,
      reason: `Token limit reached (${stats.tokensProcessed}/${CONTEXT_LIMITS.maxTokensProcessed})`,
      warnings,
    };
  }

  if (idleMinutes >= CONTEXT_LIMITS.maxIdleMinutes) {
    return {
      shouldRotate: true,
      reason: `Session idle for ${Math.round(idleMinutes)} minutes`,
      warnings,
    };
  }

  if (stats.conversationTurns >= CONTEXT_LIMITS.maxConversationTurns) {
    return {
      shouldRotate: true,
      reason: `Conversation limit reached (${stats.conversationTurns} turns)`,
      warnings,
    };
  }

  // Check warning thresholds
  const threshold = CONTEXT_LIMITS.warningThreshold;

  if (stats.toolCalls >= CONTEXT_LIMITS.maxToolCalls * threshold) {
    warnings.push(
      `Approaching tool call limit (${stats.toolCalls}/${CONTEXT_LIMITS.maxToolCalls})`
    );
  }

  if (stats.tokensProcessed >= CONTEXT_LIMITS.maxTokensProcessed * threshold) {
    warnings.push(
      `Approaching token limit (${stats.tokensProcessed}/${CONTEXT_LIMITS.maxTokensProcessed})`
    );
  }

  if (stats.conversationTurns >= CONTEXT_LIMITS.maxConversationTurns * threshold) {
    warnings.push(
      `Approaching conversation limit (${stats.conversationTurns} turns)`
    );
  }

  return {
    shouldRotate: false,
    reason: null,
    warnings,
  };
}

/**
 * Create a handoff summary for transitioning to a new session
 */
export function createHandoffSummary(state: ContextState): string {
  const lines: string[] = [];

  lines.push("# Session Handoff Summary");
  lines.push("");

  // Current task
  if (state.currentTask) {
    lines.push("## Current Task");
    lines.push(state.currentTask);
    lines.push("");
  }

  // Completed tasks
  if (state.completedTasks.length > 0) {
    lines.push("## Completed Tasks");
    state.completedTasks.forEach((task) => {
      lines.push(`- ${task}`);
    });
    lines.push("");
  }

  // Pending tasks
  if (state.pendingTasks.length > 0) {
    lines.push("## Pending Tasks");
    state.pendingTasks.forEach((task) => {
      lines.push(`- ${task}`);
    });
    lines.push("");
  }

  // Active files
  if (state.activeFiles.length > 0) {
    lines.push("## Active Files");
    state.activeFiles.forEach((file) => {
      lines.push(`- \`${file}\``);
    });
    lines.push("");
  }

  // Recent decisions
  if (state.recentDecisions.length > 0) {
    lines.push("## Recent Decisions");
    state.recentDecisions.forEach(({ decision, rationale }) => {
      lines.push(`- **${decision}**: ${rationale}`);
    });
    lines.push("");
  }

  // Errors encountered
  if (state.errors.length > 0) {
    lines.push("## Errors Encountered");
    state.errors.forEach((error) => {
      lines.push(`- ${error}`);
    });
    lines.push("");
  }

  // Additional notes
  if (state.notes.length > 0) {
    lines.push("## Notes");
    state.notes.forEach((note) => {
      lines.push(`- ${note}`);
    });
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Parse a handoff summary back into context state
 */
export function parseHandoffSummary(summary: string): Partial<ContextState> {
  const state: Partial<ContextState> = {
    completedTasks: [],
    pendingTasks: [],
    activeFiles: [],
    recentDecisions: [],
    errors: [],
    notes: [],
  };

  const sections = summary.split(/^## /m);

  for (const section of sections) {
    const lines = section.trim().split("\n");
    const title = lines[0]?.toLowerCase() || "";

    if (title === "current task") {
      state.currentTask = lines.slice(1).join("\n").trim();
    } else if (title === "completed tasks") {
      state.completedTasks = lines
        .slice(1)
        .filter((l) => l.startsWith("- "))
        .map((l) => l.slice(2));
    } else if (title === "pending tasks") {
      state.pendingTasks = lines
        .slice(1)
        .filter((l) => l.startsWith("- "))
        .map((l) => l.slice(2));
    } else if (title === "active files") {
      state.activeFiles = lines
        .slice(1)
        .filter((l) => l.startsWith("- "))
        .map((l) => l.slice(2).replace(/`/g, ""));
    } else if (title === "recent decisions") {
      lines
        .slice(1)
        .filter((l) => l.startsWith("- "))
        .forEach((l) => {
          const match = l.match(/^\- \*\*(.+?)\*\*: (.+)$/);
          if (match) {
            state.recentDecisions!.push({
              decision: match[1],
              rationale: match[2],
            });
          }
        });
    } else if (title === "errors encountered") {
      state.errors = lines
        .slice(1)
        .filter((l) => l.startsWith("- "))
        .map((l) => l.slice(2));
    } else if (title === "notes") {
      state.notes = lines
        .slice(1)
        .filter((l) => l.startsWith("- "))
        .map((l) => l.slice(2));
    }
  }

  return state;
}

/**
 * Calculate session health score (0-100)
 */
export function getSessionHealth(stats: SessionStats): {
  score: number;
  status: "healthy" | "warning" | "critical";
  details: string[];
} {
  const details: string[] = [];
  let score = 100;

  // Tool calls factor
  const toolRatio = stats.toolCalls / CONTEXT_LIMITS.maxToolCalls;
  if (toolRatio > 0.9) {
    score -= 30;
    details.push("Tool calls near limit");
  } else if (toolRatio > 0.7) {
    score -= 15;
    details.push("Tool calls elevated");
  }

  // Token factor
  const tokenRatio = stats.tokensProcessed / CONTEXT_LIMITS.maxTokensProcessed;
  if (tokenRatio > 0.9) {
    score -= 30;
    details.push("Tokens near limit");
  } else if (tokenRatio > 0.7) {
    score -= 15;
    details.push("Tokens elevated");
  }

  // Conversation turns factor
  const turnRatio = stats.conversationTurns / CONTEXT_LIMITS.maxConversationTurns;
  if (turnRatio > 0.9) {
    score -= 20;
    details.push("Many conversation turns");
  } else if (turnRatio > 0.7) {
    score -= 10;
    details.push("Conversation turns elevated");
  }

  // Session duration factor (long sessions may drift)
  const sessionHours =
    (Date.now() - stats.startedAt.getTime()) / (1000 * 60 * 60);
  if (sessionHours > 4) {
    score -= 10;
    details.push("Long session duration");
  }

  // Determine status
  let status: "healthy" | "warning" | "critical";
  if (score >= 70) {
    status = "healthy";
  } else if (score >= 40) {
    status = "warning";
  } else {
    status = "critical";
  }

  return { score: Math.max(0, score), status, details };
}

/**
 * Create initial session stats
 */
export function createSessionStats(): SessionStats {
  const now = new Date();
  return {
    toolCalls: 0,
    tokensProcessed: 0,
    lastActivityAt: now,
    conversationTurns: 0,
    startedAt: now,
  };
}

/**
 * Update session stats with new activity
 */
export function updateSessionStats(
  stats: SessionStats,
  update: {
    toolCalls?: number;
    tokensProcessed?: number;
    conversationTurns?: number;
  }
): SessionStats {
  return {
    ...stats,
    toolCalls: stats.toolCalls + (update.toolCalls || 0),
    tokensProcessed: stats.tokensProcessed + (update.tokensProcessed || 0),
    conversationTurns: stats.conversationTurns + (update.conversationTurns || 0),
    lastActivityAt: new Date(),
  };
}
