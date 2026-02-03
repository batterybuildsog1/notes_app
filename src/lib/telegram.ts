/**
 * Telegram Bot API wrapper for note clarification workflow
 */

import { neon } from "@neondatabase/serverless";

const TELEGRAM_API_BASE = "https://api.telegram.org/bot";

interface TelegramMessage {
  message_id: number;
  text?: string;
  date: number;
  chat: { id: number };
  reply_to_message?: {
    message_id: number;
  };
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

function getConfig() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    return null;
  }

  return { botToken, chatId };
}

/**
 * Send a message via Telegram
 */
export async function sendTelegramMessage(
  message: string,
  options?: { parseMode?: "Markdown" | "HTML" }
): Promise<{ success: boolean; messageId?: number; error?: string }> {
  const config = getConfig();
  if (!config) {
    console.warn("[TELEGRAM] Bot token or chat ID not configured");
    return { success: false, error: "Telegram not configured" };
  }

  try {
    const url = `${TELEGRAM_API_BASE}${config.botToken}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: config.chatId,
        text: message,
        parse_mode: options?.parseMode,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("[TELEGRAM] Send message failed:", error);
      return { success: false, error };
    }

    const data = await response.json();
    return {
      success: true,
      messageId: data.result?.message_id,
    };
  } catch (error) {
    console.error("[TELEGRAM] Send message error:", error);
    return { success: false, error: String(error) };
  }
}

/**
 * Get recent messages (for checking replies)
 */
export async function getRecentMessages(
  limit: number = 10
): Promise<TelegramMessage[]> {
  const config = getConfig();
  if (!config) {
    return [];
  }

  try {
    const url = `${TELEGRAM_API_BASE}${config.botToken}/getUpdates`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        limit,
        allowed_updates: ["message"],
      }),
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    const updates: TelegramUpdate[] = data.result || [];

    return updates
      .filter((u) => u.message?.text)
      .map((u) => u.message!)
      .filter((m) => m.chat.id.toString() === config.chatId);
  } catch (error) {
    console.error("[TELEGRAM] Get messages error:", error);
    return [];
  }
}

/**
 * Check if Telegram is configured
 */
export function isTelegramConfigured(): boolean {
  return getConfig() !== null;
}

/**
 * Get updates from Telegram with offset support for polling
 * Use offset to only get updates after a certain update_id
 */
export async function getUpdates(
  offset?: number,
  limit: number = 100
): Promise<TelegramUpdate[]> {
  const config = getConfig();
  if (!config) {
    return [];
  }

  try {
    const url = `${TELEGRAM_API_BASE}${config.botToken}/getUpdates`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        offset,
        limit,
        allowed_updates: ["message"],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("[TELEGRAM] Get updates failed:", error);
      return [];
    }

    const data = await response.json();
    const updates: TelegramUpdate[] = data.result || [];

    // Filter to only messages from our chat
    return updates.filter(
      (u) => u.message?.chat.id.toString() === config.chatId
    );
  } catch (error) {
    console.error("[TELEGRAM] Get updates error:", error);
    return [];
  }
}

/**
 * Get the last processed update_id from database
 */
export async function getLastUpdateId(): Promise<number | null> {
  try {
    const sql = neon(process.env.DATABASE_URL!);
    const rows = await sql`
      SELECT value FROM key_value WHERE key = 'telegram_last_update_id'
    `;
    if (rows.length > 0) {
      return parseInt((rows[0] as { value: string }).value);
    }
    return null;
  } catch (error) {
    console.error("[TELEGRAM] Get last update_id error:", error);
    return null;
  }
}

/**
 * Store the last processed update_id in database
 */
export async function setLastUpdateId(updateId: number): Promise<void> {
  try {
    const sql = neon(process.env.DATABASE_URL!);
    await sql`
      INSERT INTO key_value (key, value, updated_at)
      VALUES ('telegram_last_update_id', ${updateId.toString()}, NOW())
      ON CONFLICT (key)
      DO UPDATE SET value = ${updateId.toString()}, updated_at = NOW()
    `;
  } catch (error) {
    console.error("[TELEGRAM] Set last update_id error:", error);
  }
}
