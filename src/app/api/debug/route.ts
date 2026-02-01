import { NextRequest, NextResponse } from "next/server";
import { checkServiceAuth } from "@/lib/service-auth";
import { neon } from "@neondatabase/serverless";

/**
 * Debug endpoint to check env vars and auth (REMOVE IN PRODUCTION)
 */
export async function GET(request: NextRequest) {
  const serviceAuth = checkServiceAuth(request);
  
  // Test DB query
  let dbTest = null;
  if (serviceAuth.authenticated && serviceAuth.userId) {
    try {
      const sql = neon(process.env.DATABASE_URL!);
      const result = await sql`SELECT COUNT(*) as count FROM notes WHERE user_id = ${serviceAuth.userId}`;
      dbTest = result[0];
    } catch (e) {
      dbTest = { error: String(e) };
    }
  }

  return NextResponse.json({
    env: {
      hasServiceApiKeys: !!process.env.SERVICE_API_KEYS,
      serviceApiKeysLength: (process.env.SERVICE_API_KEYS || "").length,
      hasServiceUserId: !!process.env.SERVICE_USER_ID,
      serviceUserIdFull: process.env.SERVICE_USER_ID,
      hasDbUrl: !!process.env.DATABASE_URL,
    },
    auth: serviceAuth,
    dbTest,
    headers: {
      hasApiKey: !!request.headers.get("X-API-Key"),
      apiKeyLength: request.headers.get("X-API-Key")?.length,
    },
  });
}
