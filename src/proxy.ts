/**
 * @file Next.js proxy for route protection.
 *
 * Checks for a BetterAuth session cookie on every request. Unauthenticated
 * users trying to access /dashboard are redirected to the landing page.
 * Authenticated users trying to access / are redirected to /dashboard.
 *
 * This runs on the Node.js runtime before the page renders, so protected
 * pages never flash unauthenticated content.
 *
 * Next.js 16 renamed "middleware" to "proxy" to better describe the
 * network-boundary behavior. See: https://nextjs.org/docs/messages/middleware-to-proxy
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

export async function proxy(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);
  const { pathname } = request.nextUrl;

  // Authenticated user on landing page → send to dashboard
  if (sessionCookie && pathname === "/") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // Unauthenticated user on protected route → send to landing page
  if (!sessionCookie && pathname.startsWith("/dashboard")) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

/**
 * Only run the proxy on these paths. API routes and static assets are
 * excluded so they don't get redirected.
 */
export const config = {
  matcher: ["/", "/dashboard/:path*"],
};
