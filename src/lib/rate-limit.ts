/**
 * Simple in-memory rate limiter for API routes.
 * For production with multiple instances, use Redis-based solution like @upstash/ratelimit.
 */

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();

// Clean up old entries every minute
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap.entries()) {
    if (entry.resetTime < now) {
      rateLimitMap.delete(key);
    }
  }
}, 60000);

interface RateLimitOptions {
  limit?: number; // Max requests per window
  windowMs?: number; // Time window in milliseconds
}

interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetIn: number; // Seconds until reset
}

/**
 * Check rate limit for a given identifier (e.g., user ID or IP).
 *
 * @param identifier - Unique identifier for rate limiting (user ID recommended)
 * @param options - Rate limit configuration
 * @returns Rate limit result with success flag and remaining requests
 */
export function checkRateLimit(
  identifier: string,
  options: RateLimitOptions = {}
): RateLimitResult {
  const { limit = 100, windowMs = 60000 } = options; // Default: 100 requests per minute
  const now = Date.now();
  const key = identifier;

  let entry = rateLimitMap.get(key);

  // If no entry or window expired, create new entry
  if (!entry || entry.resetTime < now) {
    entry = {
      count: 1,
      resetTime: now + windowMs,
    };
    rateLimitMap.set(key, entry);
    return {
      success: true,
      remaining: limit - 1,
      resetIn: Math.ceil(windowMs / 1000),
    };
  }

  // Increment count
  entry.count++;

  // Check if over limit
  if (entry.count > limit) {
    return {
      success: false,
      remaining: 0,
      resetIn: Math.ceil((entry.resetTime - now) / 1000),
    };
  }

  return {
    success: true,
    remaining: limit - entry.count,
    resetIn: Math.ceil((entry.resetTime - now) / 1000),
  };
}

/**
 * Rate limit middleware result headers
 */
export function rateLimitHeaders(result: RateLimitResult): HeadersInit {
  return {
    "X-RateLimit-Remaining": result.remaining.toString(),
    "X-RateLimit-Reset": result.resetIn.toString(),
  };
}
