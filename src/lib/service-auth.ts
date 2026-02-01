/**
 * Service Account Authentication
 * 
 * Allows API key auth for external agents/services.
 * API keys are stored in environment variable for simplicity.
 */

import { NextRequest } from "next/server";

// Service accounts are defined in env: SERVICE_API_KEYS=key1:name1,key2:name2
const serviceAccounts = new Map<string, string>();

function loadServiceAccounts() {
  const keys = process.env.SERVICE_API_KEYS || "";
  if (!keys) return;

  keys.split(",").forEach((entry) => {
    const [key, name] = entry.split(":");
    if (key && name) {
      serviceAccounts.set(key.trim(), name.trim());
    }
  });
}

// Load on module init
loadServiceAccounts();

export interface ServiceAuth {
  authenticated: boolean;
  serviceName: string | null;
  userId: string | null; // For service accounts, we use a fixed service user ID
}

/**
 * Check if request has valid service API key
 */
export function checkServiceAuth(request: NextRequest): ServiceAuth {
  const apiKey = request.headers.get("X-API-Key");

  if (!apiKey) {
    return { authenticated: false, serviceName: null, userId: null };
  }

  const serviceName = serviceAccounts.get(apiKey);
  if (!serviceName) {
    return { authenticated: false, serviceName: null, userId: null };
  }

  // Service accounts use a fixed service user ID from env
  const serviceUserId = process.env.SERVICE_USER_ID;
  if (!serviceUserId) {
    console.warn("[SERVICE-AUTH] SERVICE_USER_ID not set");
    return { authenticated: false, serviceName: null, userId: null };
  }

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
  return Array.from(serviceAccounts.values());
}
