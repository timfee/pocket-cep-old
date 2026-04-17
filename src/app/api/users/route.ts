/**
 * @file Server-side user search via Google Admin SDK Directory API.
 *
 * GET /api/users?q=alice → searches users by email/name
 * GET /api/users         → returns first 20 users
 *
 * Auth failures return HTTP 401 with an AuthErrorPayload so the client
 * can render an actionable remedy instead of silently showing an empty
 * dropdown.
 */

import { NextResponse, type NextRequest } from "next/server";
import { getGoogleAccessToken } from "@/lib/access-token";
import { searchUsers, buildAdminQuery, type DirectoryUser } from "@/lib/admin-sdk";
import { isAuthError } from "@/lib/auth-errors";
import { requireSession } from "@/lib/session";
import { getErrorMessage } from "@/lib/errors";

export type { DirectoryUser };

/**
 * Searches the org's user directory. The optional `q` query parameter
 * is passed to the Admin SDK as a server-side filter.
 */
export async function GET(request: NextRequest) {
  if (!(await requireSession())) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const query = request.nextUrl.searchParams.get("q") ?? "";
  const accessToken = await getGoogleAccessToken();
  const adminQuery = buildAdminQuery(query);

  try {
    const users = await searchUsers(adminQuery, accessToken);
    return NextResponse.json({ users });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json({ error: error.toPayload() }, { status: 401 });
    }
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
