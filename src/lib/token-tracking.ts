/**
 * Token Usage Tracking
 *
 * Tracks API token consumption and costs for Grok, OpenAI, and other AI services.
 * Provides utilities for estimating tokens and querying usage statistics.
 */

import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

// Token usage interface
export interface TokenUsage {
  model: string;
  operation: string;
  inputTokens: number;
  outputTokens: number;
  noteId?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}

// Cost per 1K tokens (USD) - updated for current pricing
// These are approximate and should be updated as pricing changes
export const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  // Grok models (xAI)
  "grok-4-1-fast-reasoning": { input: 0.003, output: 0.015 },
  "grok-4-1": { input: 0.003, output: 0.015 },
  "grok-beta": { input: 0.005, output: 0.015 },

  // OpenAI models
  "text-embedding-3-small": { input: 0.00002, output: 0 },
  "text-embedding-3-large": { input: 0.00013, output: 0 },
  "gpt-4-turbo": { input: 0.01, output: 0.03 },
  "gpt-4o": { input: 0.005, output: 0.015 },
  "gpt-4o-mini": { input: 0.00015, output: 0.0006 },
  "gpt-3.5-turbo": { input: 0.0005, output: 0.0015 },
};

/**
 * Calculate cost from token counts
 */
export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const costs = MODEL_COSTS[model] || { input: 0.001, output: 0.002 }; // Default fallback
  return (inputTokens * costs.input + outputTokens * costs.output) / 1000;
}

/**
 * Estimate tokens from text (rough approximation)
 * Uses ~4 characters per token as a general rule
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // Rough estimate: ~4 chars per token for English text
  // This is approximate - actual tokenization varies by model
  return Math.ceil(text.length / 4);
}

/**
 * Track token usage to database
 */
export async function trackTokenUsage(usage: TokenUsage): Promise<void> {
  try {
    const cost = calculateCost(usage.model, usage.inputTokens, usage.outputTokens);

    await sql`
      INSERT INTO token_usage (
        model,
        operation,
        input_tokens,
        output_tokens,
        cost_usd,
        note_id,
        user_id,
        metadata
      ) VALUES (
        ${usage.model},
        ${usage.operation},
        ${usage.inputTokens},
        ${usage.outputTokens},
        ${cost},
        ${usage.noteId || null},
        ${usage.userId || null},
        ${usage.metadata ? JSON.stringify(usage.metadata) : null}
      )
    `;
  } catch (error) {
    // Log but don't throw - token tracking shouldn't break main functionality
    console.error("[TOKEN-TRACKING] Failed to track usage:", error);
  }
}

/**
 * Get usage for today
 */
export async function getDailyUsage(): Promise<{
  total: number;
  totalTokens: { input: number; output: number };
  byOperation: Record<string, { cost: number; input: number; output: number }>;
  byModel: Record<string, { cost: number; input: number; output: number }>;
}> {
  const [operationRows, modelRows, totalRows] = await Promise.all([
    sql`
      SELECT
        operation,
        SUM(cost_usd) as cost,
        SUM(input_tokens) as input,
        SUM(output_tokens) as output
      FROM token_usage
      WHERE DATE(timestamp) = CURRENT_DATE
      GROUP BY operation
    `,
    sql`
      SELECT
        model,
        SUM(cost_usd) as cost,
        SUM(input_tokens) as input,
        SUM(output_tokens) as output
      FROM token_usage
      WHERE DATE(timestamp) = CURRENT_DATE
      GROUP BY model
    `,
    sql`
      SELECT
        SUM(cost_usd) as total_cost,
        SUM(input_tokens) as total_input,
        SUM(output_tokens) as total_output
      FROM token_usage
      WHERE DATE(timestamp) = CURRENT_DATE
    `,
  ]);

  const byOperation: Record<string, { cost: number; input: number; output: number }> = {};
  for (const row of operationRows) {
    const r = row as { operation: string; cost: string; input: string; output: string };
    byOperation[r.operation] = {
      cost: parseFloat(r.cost) || 0,
      input: parseInt(r.input) || 0,
      output: parseInt(r.output) || 0,
    };
  }

  const byModel: Record<string, { cost: number; input: number; output: number }> = {};
  for (const row of modelRows) {
    const r = row as { model: string; cost: string; input: string; output: string };
    byModel[r.model] = {
      cost: parseFloat(r.cost) || 0,
      input: parseInt(r.input) || 0,
      output: parseInt(r.output) || 0,
    };
  }

  const totals = totalRows[0] as {
    total_cost: string | null;
    total_input: string | null;
    total_output: string | null;
  };

  return {
    total: parseFloat(totals?.total_cost || "0"),
    totalTokens: {
      input: parseInt(totals?.total_input || "0"),
      output: parseInt(totals?.total_output || "0"),
    },
    byOperation,
    byModel,
  };
}

/**
 * Get usage for current week (last 7 days)
 */
export async function getWeeklyUsage(): Promise<{
  total: number;
  totalTokens: { input: number; output: number };
  byOperation: Record<string, { cost: number; input: number; output: number }>;
  byModel: Record<string, { cost: number; input: number; output: number }>;
  byDay: Array<{ date: string; cost: number; input: number; output: number }>;
}> {
  const [operationRows, modelRows, dailyRows, totalRows] = await Promise.all([
    sql`
      SELECT
        operation,
        SUM(cost_usd) as cost,
        SUM(input_tokens) as input,
        SUM(output_tokens) as output
      FROM token_usage
      WHERE timestamp >= NOW() - INTERVAL '7 days'
      GROUP BY operation
    `,
    sql`
      SELECT
        model,
        SUM(cost_usd) as cost,
        SUM(input_tokens) as input,
        SUM(output_tokens) as output
      FROM token_usage
      WHERE timestamp >= NOW() - INTERVAL '7 days'
      GROUP BY model
    `,
    sql`
      SELECT
        DATE(timestamp) as date,
        SUM(cost_usd) as cost,
        SUM(input_tokens) as input,
        SUM(output_tokens) as output
      FROM token_usage
      WHERE timestamp >= NOW() - INTERVAL '7 days'
      GROUP BY DATE(timestamp)
      ORDER BY date
    `,
    sql`
      SELECT
        SUM(cost_usd) as total_cost,
        SUM(input_tokens) as total_input,
        SUM(output_tokens) as total_output
      FROM token_usage
      WHERE timestamp >= NOW() - INTERVAL '7 days'
    `,
  ]);

  const byOperation: Record<string, { cost: number; input: number; output: number }> = {};
  for (const row of operationRows) {
    const r = row as { operation: string; cost: string; input: string; output: string };
    byOperation[r.operation] = {
      cost: parseFloat(r.cost) || 0,
      input: parseInt(r.input) || 0,
      output: parseInt(r.output) || 0,
    };
  }

  const byModel: Record<string, { cost: number; input: number; output: number }> = {};
  for (const row of modelRows) {
    const r = row as { model: string; cost: string; input: string; output: string };
    byModel[r.model] = {
      cost: parseFloat(r.cost) || 0,
      input: parseInt(r.input) || 0,
      output: parseInt(r.output) || 0,
    };
  }

  const byDay: Array<{ date: string; cost: number; input: number; output: number }> = [];
  for (const row of dailyRows) {
    const r = row as { date: string; cost: string; input: string; output: string };
    byDay.push({
      date: r.date,
      cost: parseFloat(r.cost) || 0,
      input: parseInt(r.input) || 0,
      output: parseInt(r.output) || 0,
    });
  }

  const totals = totalRows[0] as {
    total_cost: string | null;
    total_input: string | null;
    total_output: string | null;
  };

  return {
    total: parseFloat(totals?.total_cost || "0"),
    totalTokens: {
      input: parseInt(totals?.total_input || "0"),
      output: parseInt(totals?.total_output || "0"),
    },
    byOperation,
    byModel,
    byDay,
  };
}

/**
 * Get usage for current month
 */
export async function getMonthlyUsage(): Promise<{
  total: number;
  totalTokens: { input: number; output: number };
  byOperation: Record<string, { cost: number; input: number; output: number }>;
  byModel: Record<string, { cost: number; input: number; output: number }>;
  byDay: Array<{ date: string; cost: number; input: number; output: number }>;
}> {
  const [operationRows, modelRows, dailyRows, totalRows] = await Promise.all([
    sql`
      SELECT
        operation,
        SUM(cost_usd) as cost,
        SUM(input_tokens) as input,
        SUM(output_tokens) as output
      FROM token_usage
      WHERE DATE_TRUNC('month', timestamp) = DATE_TRUNC('month', CURRENT_DATE)
      GROUP BY operation
    `,
    sql`
      SELECT
        model,
        SUM(cost_usd) as cost,
        SUM(input_tokens) as input,
        SUM(output_tokens) as output
      FROM token_usage
      WHERE DATE_TRUNC('month', timestamp) = DATE_TRUNC('month', CURRENT_DATE)
      GROUP BY model
    `,
    sql`
      SELECT
        DATE(timestamp) as date,
        SUM(cost_usd) as cost,
        SUM(input_tokens) as input,
        SUM(output_tokens) as output
      FROM token_usage
      WHERE DATE_TRUNC('month', timestamp) = DATE_TRUNC('month', CURRENT_DATE)
      GROUP BY DATE(timestamp)
      ORDER BY date
    `,
    sql`
      SELECT
        SUM(cost_usd) as total_cost,
        SUM(input_tokens) as total_input,
        SUM(output_tokens) as total_output
      FROM token_usage
      WHERE DATE_TRUNC('month', timestamp) = DATE_TRUNC('month', CURRENT_DATE)
    `,
  ]);

  const byOperation: Record<string, { cost: number; input: number; output: number }> = {};
  for (const row of operationRows) {
    const r = row as { operation: string; cost: string; input: string; output: string };
    byOperation[r.operation] = {
      cost: parseFloat(r.cost) || 0,
      input: parseInt(r.input) || 0,
      output: parseInt(r.output) || 0,
    };
  }

  const byModel: Record<string, { cost: number; input: number; output: number }> = {};
  for (const row of modelRows) {
    const r = row as { model: string; cost: string; input: string; output: string };
    byModel[r.model] = {
      cost: parseFloat(r.cost) || 0,
      input: parseInt(r.input) || 0,
      output: parseInt(r.output) || 0,
    };
  }

  const byDay: Array<{ date: string; cost: number; input: number; output: number }> = [];
  for (const row of dailyRows) {
    const r = row as { date: string; cost: string; input: string; output: string };
    byDay.push({
      date: r.date,
      cost: parseFloat(r.cost) || 0,
      input: parseInt(r.input) || 0,
      output: parseInt(r.output) || 0,
    });
  }

  const totals = totalRows[0] as {
    total_cost: string | null;
    total_input: string | null;
    total_output: string | null;
  };

  return {
    total: parseFloat(totals?.total_cost || "0"),
    totalTokens: {
      input: parseInt(totals?.total_input || "0"),
      output: parseInt(totals?.total_output || "0"),
    },
    byOperation,
    byModel,
    byDay,
  };
}

/**
 * Get cost per note for a specific note
 */
export async function getNoteCost(noteId: string): Promise<{
  total: number;
  operations: Array<{
    operation: string;
    model: string;
    cost: number;
    timestamp: Date;
  }>;
}> {
  const rows = await sql`
    SELECT operation, model, cost_usd as cost, timestamp
    FROM token_usage
    WHERE note_id = ${noteId}
    ORDER BY timestamp DESC
  `;

  const operations = rows.map((r) => {
    const row = r as { operation: string; model: string; cost: string; timestamp: Date };
    return {
      operation: row.operation,
      model: row.model,
      cost: parseFloat(row.cost),
      timestamp: row.timestamp,
    };
  });

  const total = operations.reduce((sum, op) => sum + op.cost, 0);

  return { total, operations };
}

/**
 * Get all-time usage summary
 */
export async function getAllTimeUsage(): Promise<{
  total: number;
  totalTokens: { input: number; output: number };
  apiCalls: number;
  oldestRecord: Date | null;
  newestRecord: Date | null;
}> {
  const rows = await sql`
    SELECT
      SUM(cost_usd) as total_cost,
      SUM(input_tokens) as total_input,
      SUM(output_tokens) as total_output,
      COUNT(*) as api_calls,
      MIN(timestamp) as oldest,
      MAX(timestamp) as newest
    FROM token_usage
  `;

  const totals = rows[0] as {
    total_cost: string | null;
    total_input: string | null;
    total_output: string | null;
    api_calls: string;
    oldest: Date | null;
    newest: Date | null;
  };

  return {
    total: parseFloat(totals?.total_cost || "0"),
    totalTokens: {
      input: parseInt(totals?.total_input || "0"),
      output: parseInt(totals?.total_output || "0"),
    },
    apiCalls: parseInt(totals?.api_calls || "0"),
    oldestRecord: totals?.oldest || null,
    newestRecord: totals?.newest || null,
  };
}
