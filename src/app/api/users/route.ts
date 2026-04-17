/**
 * @file Server-side user search via Google Admin SDK Directory API.
 *
 * GET /api/users?q=alice → searches users by email/name
 * GET /api/users         → returns first 20 users
 *
 * Uses the Admin SDK REST API directly (not through MCP) because
 * the MCP server doesn't have a user directory tool. Supports
 * server-side query filtering so the combobox can search 10K+ orgs
 * without loading all users into the browser.
 */

import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { getGoogleAccessToken } from "@/lib/access-token";
import { searchUsers, buildAdminQuery, type DirectoryUser } from "@/lib/admin-sdk";

export type { DirectoryUser };

/**
 * Searches the org's user directory. The optional `q` query parameter
 * is passed to the Admin SDK as a server-side filter.
 */
export async function GET(request: NextRequest) {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const query = request.nextUrl.searchParams.get("q") ?? "";
  const accessToken = await getGoogleAccessToken();

  const adminQuery = buildAdminQuery(query);

  const users = await searchUsers(adminQuery, accessToken);

  return NextResponse.json({ users });
}
