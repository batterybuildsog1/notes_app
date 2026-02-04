import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

// Routes that don't require authentication
const PUBLIC_ROUTES = ["/login", "/api/auth", "/api/health", "/api/telegram/webhook", "/api/cron"];

// Check if route is public
function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + "/")
  );
}

// Check if request has valid service API key
function hasValidApiKey(request: NextRequest): boolean {
  const apiKey = request.headers.get("X-API-Key");
  if (!apiKey) return false;

  // API keys are validated in the route handlers via service-auth.ts
  // Here we just check if the header is present
  return apiKey.length > 0;
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const sessionCookie = getSessionCookie(request);
  const isApiRoute = pathname.startsWith("/api/");

  // Public routes - allow without auth
  if (isPublicRoute(pathname)) {
    // If user is logged in and tries to access login, redirect to home
    if (pathname === "/login" && sessionCookie) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  // API routes - check session OR API key
  if (isApiRoute) {
    if (sessionCookie || hasValidApiKey(request)) {
      return NextResponse.next();
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Protected page routes - require session
  if (!sessionCookie) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, sitemap.xml, robots.txt (metadata files)
     * - manifest.json, icons (PWA files)
     */
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|manifest.json|icons/).*)",
  ],
};
