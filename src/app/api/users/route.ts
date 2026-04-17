/**
 * @file API route to list managed Chrome users.
 *
 * Fetches from two MCP sources in parallel:
 *   1. list_customer_profiles — all managed browser profiles (the full user list)
 *   2. get_chrome_activity_log — recent events (annotates users with activity counts)
 *
 * This gives the frontend a complete list for autocomplete while highlighting
 * users with recent activity at the top.
 *
 * GET /api/users → { users: [{ email, eventCount, lastActive?, source }] }
 */

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { callMcpTool } from "@/lib/mcp-client";
import { getGoogleAccessToken } from "@/lib/access-token";
import { getEnv } from "@/lib/env";
import { LOG_TAGS } from "@/lib/constants";
import { getErrorMessage } from "@/lib/errors";

export type UserEntry = {
  email: string;
  eventCount: number;
  lastActive?: string;
  source: "profile" | "activity";
};

export async function GET() {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const config = getEnv();
  const accessToken = await getGoogleAccessToken();

  // Fetch profiles and activity in parallel. Either can fail independently.
  const [profilesResult, activityResult] = await Promise.allSettled([
    callMcpTool(config.MCP_SERVER_URL, "list_customer_profiles", {}, accessToken),
    callMcpTool(
      config.MCP_SERVER_URL,
      "get_chrome_activity_log",
      { userKey: "all", maxResults: 200 },
      accessToken,
    ),
  ]);

  if (profilesResult.status === "rejected" && activityResult.status === "rejected") {
    const message = getErrorMessage(profilesResult.reason, "MCP call failed");
    console.error(LOG_TAGS.MCP, "Both MCP calls failed:", message);

    const isFetchFailed = message.includes("fetch failed") || message.includes("ECONNREFUSED");
    const hint = isFetchFailed
      ? `MCP server is not reachable at ${config.MCP_SERVER_URL}. ` +
        "Start it with: npm run dev:full"
      : message;

    return NextResponse.json({ error: hint }, { status: 502 });
  }

  const profileEmails = new Map<string, { lastActive?: string }>();
  if (profilesResult.status === "fulfilled") {
    extractProfileEmails(profilesResult.value.content, profileEmails);
  }

  const activityCounts = new Map<string, number>();
  if (activityResult.status === "fulfilled") {
    extractActivityCounts(activityResult.value.content, activityCounts);
  }

  const allEmails = new Set([...profileEmails.keys(), ...activityCounts.keys()]);
  const users: UserEntry[] = Array.from(allEmails).map((email) => ({
    email,
    eventCount: activityCounts.get(email) ?? 0,
    lastActive: profileEmails.get(email)?.lastActive,
    source: profileEmails.has(email) ? "profile" : "activity",
  }));

  users.sort((a, b) => {
    if (a.eventCount !== b.eventCount) return b.eventCount - a.eventCount;
    return a.email.localeCompare(b.email);
  });

  console.log(
    LOG_TAGS.MCP,
    `Found ${users.length} users (${profileEmails.size} from profiles, ${activityCounts.size} with activity)`,
  );

  return NextResponse.json({ users });
}

/**
 * Extracts unique emails and last activity time from MCP profile content.
 * The profiles response contains structured JSON with userEmail fields.
 */
function extractProfileEmails(content: unknown, out: Map<string, { lastActive?: string }>): void {
  if (!Array.isArray(content)) return;

  for (const item of content) {
    if (!item || typeof item !== "object" || !("text" in item)) continue;
    const text = (item as { text: string }).text;

    // Profiles text contains "Email: user@domain.com" lines.
    const emailMatches = text.match(/Email:\s*(\S+@\S+)/g);
    if (!emailMatches) continue;

    for (const match of emailMatches) {
      const email = match
        .replace(/^Email:\s*/, "")
        .replace(/[,;]+$/, "")
        .trim();
      if (!out.has(email)) {
        out.set(email, {});
      }
    }

    // Also look for lastActivityTime in the structured JSON block.
    const jsonMatch = text.match(/"userEmail":\s*"([^"]+)"[^}]*"lastActivityTime":\s*"([^"]+)"/g);
    if (jsonMatch) {
      for (const m of jsonMatch) {
        const emailM = m.match(/"userEmail":\s*"([^"]+)"/);
        const timeM = m.match(/"lastActivityTime":\s*"([^"]+)"/);
        if (emailM && timeM) {
          const existing = out.get(emailM[1]);
          const newTime = timeM[1];
          if (!existing?.lastActive || newTime > existing.lastActive) {
            out.set(emailM[1], { lastActive: newTime });
          }
        }
      }
    }
  }
}

/**
 * Extracts unique user emails and event counts from activity log content.
 */
export function extractActivityCounts(content: unknown, out: Map<string, number>): void {
  if (!Array.isArray(content)) return;

  for (const item of content) {
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
        out.set(email, (out.get(email) ?? 0) + 1);
      }
    }
  }
}
