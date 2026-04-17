/**
 * @file API route to list users with recent Chrome activity.
 *
 * Calls the MCP server's get_chrome_activity_log tool with userKey "all",
 * then extracts unique actor emails and their event counts. This powers
 * the user dropdown in the dashboard.
 *
 * GET /api/users → { users: [{ email, eventCount }] }
 */

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { callMcpTool } from "@/lib/mcp-client";
import { getGoogleAccessToken } from "@/lib/access-token";
import { getEnv } from "@/lib/env";
import { LOG_TAGS } from "@/lib/constants";
import { getErrorMessage } from "@/lib/errors";

/**
 * A single user entry with their email and how many events they have.
 */
type UserEntry = {
  email: string;
  eventCount: number;
};

export async function GET() {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const config = getEnv();
  const accessToken = await getGoogleAccessToken();

  try {
    const result = await callMcpTool(
      config.MCP_SERVER_URL,
      "get_chrome_activity_log",
      { userKey: "all", maxResults: 200 },
      accessToken,
    );

    const users = extractUsersFromActivities(result.content);
    console.log(LOG_TAGS.MCP, `Found ${users.length} unique users from activity log`);

    return NextResponse.json({ users });
  } catch (error) {
    const message = getErrorMessage(error, "MCP call failed");
    console.error(LOG_TAGS.MCP, "Failed to fetch activity log:", message);

    return NextResponse.json({ error: `Failed to fetch users: ${message}` }, { status: 502 });
  }
}

/**
 * Extracts unique user emails from MCP activity log content and counts
 * how many events each user has. Returns sorted by event count descending.
 */
export function extractUsersFromActivities(content: unknown): UserEntry[] {
  const counts = new Map<string, number>();

  if (!Array.isArray(content)) return [];

  for (const item of content) {
    // MCP content items have a "text" field with the formatted summary.
    // The format is: "actor: user@example.com"
    const hasText =
      item && typeof item === "object" && "text" in item && typeof item.text === "string";
    if (!hasText) continue;

    const emailMatches = item.text.match(/actor:\s*(\S+@\S+)/g);
    if (emailMatches) {
      for (const match of emailMatches) {
        const email = match
          .replace("actor: ", "")
          .replace(/[,;]+$/, "")
          .trim();
        counts.set(email, (counts.get(email) ?? 0) + 1);
      }
    }
  }

  return Array.from(counts.entries())
    .map(([email, eventCount]) => ({ email, eventCount }))
    .sort((a, b) => b.eventCount - a.eventCount);
}
