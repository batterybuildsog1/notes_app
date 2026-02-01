import { NextResponse } from "next/server";

/**
 * Debug endpoint to check env vars (REMOVE IN PRODUCTION)
 */
export async function GET() {
  return NextResponse.json({
    hasServiceApiKeys: !!process.env.SERVICE_API_KEYS,
    serviceApiKeysLength: (process.env.SERVICE_API_KEYS || "").length,
    hasServiceUserId: !!process.env.SERVICE_USER_ID,
    serviceUserIdPreview: process.env.SERVICE_USER_ID?.slice(0, 8) + "...",
    hasDbUrl: !!process.env.DATABASE_URL,
  });
}
