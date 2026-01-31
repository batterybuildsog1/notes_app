import { betterAuth } from "better-auth";
import { Pool } from "pg";
import { headers } from "next/headers";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: true,
  },
});

export const auth = betterAuth({
  database: pool,
  baseURL: process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL,
  emailAndPassword: {
    enabled: true,
  },
  trustedOrigins: [
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    "http://localhost:3000",
  ],
});

/**
 * Get the current authenticated user's ID from the session.
 * Returns null if not authenticated.
 */
export async function getAuthUserId(): Promise<string | null> {
  const headersList = await headers();
  const session = await auth.api.getSession({
    headers: headersList,
  });
  return session?.user?.id ?? null;
}

/**
 * Get the full session object for the current user.
 * Returns null if not authenticated.
 */
export async function getAuthSession() {
  const headersList = await headers();
  return auth.api.getSession({
    headers: headersList,
  });
}
