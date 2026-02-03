import { NextRequest, NextResponse } from "next/server";
import { getTemplates, createTemplate, deleteTemplate, getTemplateById } from "@/lib/db";
import { getAuthUserId } from "@/lib/auth";
import { checkServiceAuth } from "@/lib/service-auth";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";

async function getUserId(request: NextRequest): Promise<string | null> {
  const userId = await getAuthUserId();
  if (userId) return userId;

  const serviceAuth = checkServiceAuth(request);
  if (serviceAuth.authenticated) return serviceAuth.userId;

  return null;
}

/**
 * GET /api/templates
 * List all templates for the user
 */
export async function GET(request: NextRequest) {
  try {
    const userId = await getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit(`templates:get:${userId}`, {
      limit: 100,
      windowMs: 60000,
    });
    if (!rateLimit.success) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: rateLimitHeaders(rateLimit) }
      );
    }

    const templates = await getTemplates(userId);

    return NextResponse.json(templates, { headers: rateLimitHeaders(rateLimit) });
  } catch (error) {
    console.error("[TEMPLATES] Error fetching:", error);
    return NextResponse.json(
      { error: "Failed to fetch templates" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/templates
 * Create a new template
 * Body: { name, title_template?, content_template?, default_category?, default_tags? }
 */
export async function POST(request: NextRequest) {
  try {
    const userId = await getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit(`templates:create:${userId}`, {
      limit: 30,
      windowMs: 60000,
    });
    if (!rateLimit.success) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: rateLimitHeaders(rateLimit) }
      );
    }

    const body = await request.json();
    const { name, title_template, content_template, default_category, default_tags } = body;

    // Validate required fields
    if (!name || typeof name !== "string" || name.trim().length < 1) {
      return NextResponse.json(
        { error: "Name is required and must be a non-empty string" },
        { status: 400 }
      );
    }

    if (name.length > 100) {
      return NextResponse.json(
        { error: "Name must be 100 characters or less" },
        { status: 400 }
      );
    }

    // Validate optional fields
    if (title_template && typeof title_template !== "string") {
      return NextResponse.json(
        { error: "title_template must be a string" },
        { status: 400 }
      );
    }

    if (content_template && typeof content_template !== "string") {
      return NextResponse.json(
        { error: "content_template must be a string" },
        { status: 400 }
      );
    }

    if (default_category && typeof default_category !== "string") {
      return NextResponse.json(
        { error: "default_category must be a string" },
        { status: 400 }
      );
    }

    if (default_tags && !Array.isArray(default_tags)) {
      return NextResponse.json(
        { error: "default_tags must be an array of strings" },
        { status: 400 }
      );
    }

    const template = await createTemplate({
      user_id: userId,
      name: name.trim(),
      title_template: title_template?.trim(),
      content_template: content_template?.trim(),
      default_category: default_category?.trim(),
      default_tags: default_tags?.map((t: string) => t.trim()),
    });

    return NextResponse.json(template, {
      status: 201,
      headers: rateLimitHeaders(rateLimit),
    });
  } catch (error) {
    // Handle unique constraint violation
    if (error instanceof Error && error.message.includes("duplicate key")) {
      return NextResponse.json(
        { error: "A template with this name already exists" },
        { status: 409 }
      );
    }

    console.error("[TEMPLATES] Error creating:", error);
    return NextResponse.json(
      { error: "Failed to create template" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/templates
 * Delete a template by ID (passed in query string)
 * Query: ?id=<template-id>
 */
export async function DELETE(request: NextRequest) {
  try {
    const userId = await getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit(`templates:delete:${userId}`, {
      limit: 30,
      windowMs: 60000,
    });
    if (!rateLimit.success) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: rateLimitHeaders(rateLimit) }
      );
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "Template ID is required" },
        { status: 400 }
      );
    }

    // Verify template exists and belongs to user
    const existing = await getTemplateById(id, userId);
    if (!existing) {
      return NextResponse.json(
        { error: "Template not found" },
        { status: 404 }
      );
    }

    await deleteTemplate(id, userId);

    return NextResponse.json(
      { success: true, deleted: id },
      { headers: rateLimitHeaders(rateLimit) }
    );
  } catch (error) {
    console.error("[TEMPLATES] Error deleting:", error);
    return NextResponse.json(
      { error: "Failed to delete template" },
      { status: 500 }
    );
  }
}
