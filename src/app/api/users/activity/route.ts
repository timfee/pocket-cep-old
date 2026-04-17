/**
 * @file Returns a map of emails → recent Chrome activity stats.
 *
 * Calls the MCP `get_chrome_activity_log` tool (10-day default window)
 * and buckets events by `actor.email`. The UserSelector uses this to
 * pre-populate the dropdown and surface users with recent activity.
 *
 * Cached in-process per caller identity with a 10-minute TTL — the log
 * rarely changes fast enough to justify a round trip on every page load.
 */

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { getGoogleAccessToken } from "@/lib/access-token";
import { getEnv } from "@/lib/env";
import { callMcpTool } from "@/lib/mcp-client";
import { isAuthError } from "@/lib/auth-errors";
import { LOG_TAGS } from "@/lib/constants";
import { getErrorMessage } from "@/lib/errors";

const ACTIVITY_TTL_MS = 10 * 60 * 1000;
const ACTIVITY_MAX_EVENTS = 1000;

/**
 * Per-user activity summary: event count and most recent event timestamp.
 */
export type UserActivity = {
  eventCount: number;
  lastEventAt?: string;
};

const activityCache = new Map<string, { data: Record<string, UserActivity>; expiresAt: number }>();

function cacheKey(serverUrl: string, accessToken: string | undefined): string {
  if (!accessToken) return `${serverUrl}|sa`;
  const hash = createHash("sha256").update(accessToken).digest("hex").slice(0, 16);
  return `${serverUrl}|u:${hash}`;
}

export async function GET() {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const config = getEnv();
  const accessToken = await getGoogleAccessToken();

  const key = cacheKey(config.MCP_SERVER_URL, accessToken);
  const now = Date.now();
  const cached = activityCache.get(key);
  if (cached && cached.expiresAt > now) {
    return NextResponse.json({ activity: cached.data });
  }

  try {
    const result = await callMcpTool(
      config.MCP_SERVER_URL,
      "get_chrome_activity_log",
      { userKey: "all", maxResults: ACTIVITY_MAX_EVENTS },
      accessToken,
    );

    const activities = extractActivities(result.content);
    const grouped = groupByUser(activities);
    activityCache.set(key, { data: grouped, expiresAt: now + ACTIVITY_TTL_MS });
    return NextResponse.json({ activity: grouped });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json({ error: error.toPayload() }, { status: 401 });
    }

    /**
     * Auth errors are handled above. Non-auth failures (quota, transient
     * 5xx) fall through to an empty map — the selector works fine
     * without activity badges.
     */
    console.log(LOG_TAGS.MCP, "Activity fetch failed:", getErrorMessage(error));
    return NextResponse.json({ activity: {} });
  }
}

type RawActivity = { actor?: { email?: string }; id?: { time?: string } };

/**
 * The MCP tool result is an array of content blocks; the useful data
 * is a JSON string inside a `type: "text"` block.
 */
function extractActivities(content: unknown): RawActivity[] {
  if (!Array.isArray(content)) return [];
  for (const block of content) {
    if (
      block &&
      typeof block === "object" &&
      "type" in block &&
      block.type === "text" &&
      "text" in block &&
      typeof block.text === "string"
    ) {
      try {
        const parsed = JSON.parse(block.text);
        if (parsed && Array.isArray(parsed.activities)) {
          return parsed.activities as RawActivity[];
        }
      } catch {
        // skip — block wasn't JSON
      }
    }
  }
  return [];
}

function groupByUser(activities: RawActivity[]): Record<string, UserActivity> {
  const map: Record<string, UserActivity> = {};
  for (const event of activities) {
    const email = event?.actor?.email?.toLowerCase();
    if (!email) continue;
    const entry = map[email] ?? { eventCount: 0 };
    entry.eventCount += 1;
    const time = event?.id?.time;
    if (time && (!entry.lastEventAt || time > entry.lastEventAt)) {
      entry.lastEventAt = time;
    }
    map[email] = entry;
  }
  return map;
}
