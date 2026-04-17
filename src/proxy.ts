/**
 * @file Mode-aware route protection.
 *
 * service_account: no login needed. Sessionless requests are redirected to
 * /api/auth/auto-session which mints one automatically. "/" → /dashboard.
 *
 * user_oauth: requires Google OAuth sign-in. Unauthenticated users go
 * to the landing page.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { getEnv } from "@/lib/env";

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

export const config = {
  matcher: ["/", "/dashboard/:path*"],
};
