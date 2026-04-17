/**
 * @file Mints an anonymous BetterAuth session for service_account mode.
 *
 * The proxy redirects sessionless SA-mode requests here. We POST to
 * BetterAuth's anonymous sign-in endpoint, forward all Set-Cookie
 * headers, and redirect to the dashboard.
 */

import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";

export async function GET(request: Request) {
  const config = getEnv();

  if (config.AUTH_MODE !== "service_account") {
    return new Response("Not found", { status: 404 });
  }

  let response: Response;
  try {
    response = await fetch(`${config.BETTER_AUTH_URL}/api/auth/sign-in/anonymous`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return NextResponse.redirect(new URL("/?error=session_unavailable", request.url));
  }

  if (!response.ok) {
    return NextResponse.redirect(new URL("/?error=session_failed", request.url));
  }

  const cookies = response.headers.getSetCookie();
  const headers = new Headers({ Location: new URL("/dashboard", request.url).toString() });
  for (const cookie of cookies) {
    headers.append("Set-Cookie", cookie);
  }

  return new Response(null, { status: 302, headers });
}
