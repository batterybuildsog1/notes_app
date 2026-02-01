/**
 * Service Account Authentication
 * 
 * Allows API key auth for external agents/services.
 * API keys are stored in environment variable for simplicity.
 * 
 * FIXED: Load env vars lazily (not at module init) for Vercel serverless compatibility.
 */

import { NextRequest } from "next/server";

export interface ServiceAuth {
  authenticated: boolean;
  serviceName: string | null;
  userId: string | null;
}

/**
 * Parse service accounts from env var (lazy, called per-request)
 */
function getServiceAccounts(): Map<string, string> {
  const accounts = new Map<string, string>();
  const keys = process.env.SERVICE_API_KEYS || "";
  
  if (!keys) return accounts;

  keys.split(",").forEach((entry) => {
    const [key, name] = entry.split(":");
    if (key && name) {
      accounts.set(key.trim(), name.trim());
    }
  });

  return accounts;
}

/**
 * Check if request has valid service API key
 */
export function checkServiceAuth(request: NextRequest): ServiceAuth {
  const apiKey = request.headers.get("X-API-Key");

  if (!apiKey) {
    return { authenticated: false, serviceName: null, userId: null };
  }

  // Load accounts fresh each request (env vars are available at runtime)
  const serviceAccounts = getServiceAccounts();
  const serviceName = serviceAccounts.get(apiKey);
  
  if (!serviceName) {
    console.log("[SERVICE-AUTH] Invalid API key provided");
    return { authenticated: false, serviceName: null, userId: null };
  }

  // Service accounts use a fixed service user ID from env
  const serviceUserId = process.env.SERVICE_USER_ID;
  if (!serviceUserId) {
    console.warn("[SERVICE-AUTH] SERVICE_USER_ID not set in environment");
    return { authenticated: false, serviceName: null, userId: null };
  }

  console.log(`[SERVICE-AUTH] Authenticated as ${serviceName} (user: ${serviceUserId})`);
  return {
    authenticated: true,
    serviceName,
    userId: serviceUserId,
  };
}

/**
 * Get service account names (for debugging)
 */
export function getServiceAccountNames(): string[] {
  return Array.from(getServiceAccounts().values());
}
