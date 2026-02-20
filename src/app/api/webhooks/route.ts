import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth";
import { checkServiceAuth } from "@/lib/service-auth";
import { getWebhooks, createWebhook, deleteWebhook, updateWebhookActive, isValidEvent } from "@/lib/webhooks";

async function getUserId(request: NextRequest): Promise<string | null> {
  const userId = await getAuthUserId();
  if (userId) return userId;
  const serviceAuth = checkServiceAuth(request);
  if (serviceAuth.authenticated) return serviceAuth.userId;
  return null;
}

/**
 * GET /api/webhooks — List all webhooks for the user
 */
export async function GET(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const webhooks = await getWebhooks(userId);
  return NextResponse.json(webhooks);
}

/**
 * POST /api/webhooks — Register a new webhook
 * Body: { url: string, events: string[], secret?: string }
 */
export async function POST(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { url, events, secret } = body;

  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }
  if (!Array.isArray(events) || events.length === 0) {
    return NextResponse.json({ error: "events array is required" }, { status: 400 });
  }

  const validEvents = events.filter(isValidEvent);
  if (validEvents.length === 0) {
    return NextResponse.json(
      { error: "No valid events. Valid: note.created, note.updated, note.project-linked" },
      { status: 400 }
    );
  }

  const webhook = await createWebhook({ user_id: userId, url, events: validEvents, secret });
  return NextResponse.json(webhook, { status: 201 });
}

/**
 * DELETE /api/webhooks — Delete a webhook
 * Body: { id: string }
 */
export async function DELETE(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { id } = body;

  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const deleted = await deleteWebhook(id, userId);
  if (!deleted) return NextResponse.json({ error: "Webhook not found" }, { status: 404 });

  return NextResponse.json({ success: true });
}

/**
 * PATCH /api/webhooks — Toggle webhook active status
 * Body: { id: string, active: boolean }
 */
export async function PATCH(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { id, active } = body;

  if (!id || typeof active !== "boolean") {
    return NextResponse.json({ error: "id and active (boolean) are required" }, { status: 400 });
  }

  const webhook = await updateWebhookActive(id, userId, active);
  if (!webhook) return NextResponse.json({ error: "Webhook not found" }, { status: 404 });

  return NextResponse.json(webhook);
}
