import { neon } from "@neondatabase/serverless";
import { createHmac } from "crypto";

const sql = neon(process.env.DATABASE_URL!);

export interface Webhook {
  id: string;
  user_id: string;
  url: string;
  events: string[];
  secret: string | null;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

export type WebhookEvent = "note.created" | "note.updated" | "note.project-linked";

const VALID_EVENTS: WebhookEvent[] = ["note.created", "note.updated", "note.project-linked"];

export function isValidEvent(event: string): event is WebhookEvent {
  return VALID_EVENTS.includes(event as WebhookEvent);
}

export async function getWebhooks(userId: string): Promise<Webhook[]> {
  const rows = await sql`
    SELECT * FROM webhooks WHERE user_id = ${userId} ORDER BY created_at DESC
  `;
  return rows as Webhook[];
}

export async function getActiveWebhooksForEvent(
  userId: string,
  event: WebhookEvent
): Promise<Webhook[]> {
  const rows = await sql`
    SELECT * FROM webhooks
    WHERE user_id = ${userId} AND active = true AND ${event} = ANY(events)
  `;
  return rows as Webhook[];
}

export async function createWebhook(data: {
  user_id: string;
  url: string;
  events: string[];
  secret?: string;
}): Promise<Webhook> {
  const eventsArray = data.events.filter(isValidEvent);
  const rows = await sql`
    INSERT INTO webhooks (user_id, url, events, secret)
    VALUES (${data.user_id}, ${data.url}, ${eventsArray}, ${data.secret || null})
    RETURNING *
  `;
  return rows[0] as Webhook;
}

export async function deleteWebhook(id: string, userId: string): Promise<boolean> {
  const rows = await sql`
    DELETE FROM webhooks WHERE id = ${id} AND user_id = ${userId} RETURNING id
  `;
  return rows.length > 0;
}

export async function updateWebhookActive(
  id: string,
  userId: string,
  active: boolean
): Promise<Webhook | null> {
  const rows = await sql`
    UPDATE webhooks SET active = ${active}, updated_at = NOW()
    WHERE id = ${id} AND user_id = ${userId}
    RETURNING *
  `;
  return (rows[0] as Webhook) || null;
}

/**
 * Fire webhooks for a note event. Non-blocking (fire-and-forget).
 */
export async function dispatchWebhooks(
  userId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const webhooks = await getActiveWebhooksForEvent(userId, event);
    if (webhooks.length === 0) return;

    const body = JSON.stringify({ event, timestamp: new Date().toISOString(), data: payload });

    const promises = webhooks.map(async (wh) => {
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "X-Webhook-Event": event,
        };

        // HMAC signature if secret is set
        if (wh.secret) {
          const sig = createHmac("sha256", wh.secret).update(body).digest("hex");
          headers["X-Webhook-Signature"] = `sha256=${sig}`;
        }

        const res = await fetch(wh.url, {
          method: "POST",
          headers,
          body,
          signal: AbortSignal.timeout(10000), // 10s timeout
        });

        if (!res.ok) {
          console.warn(`[WEBHOOK] ${wh.url} returned ${res.status} for ${event}`);
        }
      } catch (err) {
        console.warn(`[WEBHOOK] Failed to deliver to ${wh.url}:`, err);
      }
    });

    // Fire all in parallel, don't await (fire-and-forget)
    Promise.allSettled(promises).catch(() => {});
  } catch (err) {
    console.error("[WEBHOOK] Dispatch error:", err);
  }
}
