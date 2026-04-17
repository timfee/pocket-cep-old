/**
 * @file Mode-aware route protection (Next.js 16 proxy).
 *
 * Next.js 16 renamed the `middleware.ts` convention to `proxy.ts` and
 * the exported `middleware` function to `proxy`. Placing this file at
 * `src/proxy.ts` (matching the `src` layout used elsewhere) is all
 * Next.js needs — no explicit import is required.
 *
 * service_account mode: no login needed. Sessionless requests are
 * redirected to /api/auth/auto-session which mints a cookie
 * automatically, then redirects to /dashboard. The landing page
 * at "/" is never shown.
 *
 * user_oauth mode: requires Google OAuth sign-in. Unauthenticated
 * users hitting /dashboard are redirected to "/" (landing page).
 * Authenticated users hitting "/" are redirected to /dashboard.
 *
 * The session check uses `getSessionCookie` (a cookie-name lookup)
 * rather than a full `getSession` API call. This keeps the proxy
 * fast since it runs on every matched request. The trade-off is that
 * an expired or invalid cookie will pass the proxy but fail at the
 * API layer, which returns 401 and the frontend handles it.
 *
 * The `config.matcher` limits this to "/" and "/dashboard/*" so API
 * routes, static assets, and _next/ paths are never intercepted.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { getEnv } from "@/lib/env";

/**
 * Route-protection proxy. Redirects users based on auth mode and
 * session state. Returns NextResponse.next() to allow the request
 * through when no redirect is needed.
 */
export async function proxy(request: NextRequest) {
  const { AUTH_MODE } = getEnv();
  const sessionCookie = getSessionCookie(request);
  const { pathname } = request.nextUrl;

  if (AUTH_MODE === "service_account") {
    if (!sessionCookie) {
      return NextResponse.redirect(new URL("/api/auth/auto-session", request.url));
    }
    if (pathname === "/") {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    return NextResponse.next();
  }

  if (sessionCookie && pathname === "/") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  if (!sessionCookie && pathname.startsWith("/dashboard")) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

/**
 * Next.js proxy matcher. Only intercepts the landing page and
 * dashboard routes -- API routes and static files are excluded so they
 * are not slowed down by the proxy.
 */
export const config = {
  matcher: ["/", "/dashboard/:path*"],
};
