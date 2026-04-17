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
  
  // Use user's OAuth token or fallback to ADC for Service Account mode
  let tokenToUse = accessToken;
  if (!tokenToUse) {
    const { getADCToken } = await import("@/lib/admin-sdk");
    tokenToUse = (await getADCToken()) ?? undefined;
  }

  if (!tokenToUse) {
    return NextResponse.json({ activity: {} });
  }

  const key = cacheKey(config.MCP_SERVER_URL, tokenToUse);
  const now = Date.now();
  const cached = activityCache.get(key);
  if (cached && cached.expiresAt > now) {
    return NextResponse.json({ activity: cached.data });
  }

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${tokenToUse}`,
    };

    if (!accessToken) {
      const { getQuotaProject } = await import("@/lib/admin-sdk");
      const quotaProject = await getQuotaProject();
      if (quotaProject) {
        headers["x-goog-user-project"] = quotaProject;
      }
    }

    const baseUrl = new URL("https://admin.googleapis.com/admin/reports/v1/activity/users/all/applications/chrome");
    // Provide a valid customer_id. 'my_customer' is a special alias for the authenticated customer.
    baseUrl.searchParams.set("customerId", "my_customer");

    let activities: RawActivity[] = [];
    let pageToken: string | undefined;

    do {
      const remaining = ACTIVITY_MAX_EVENTS - activities.length;
      const maxResults = Math.min(remaining, 1000);
      
      const url = new URL(baseUrl.toString());
      url.searchParams.set("maxResults", String(maxResults));
      if (pageToken) {
        url.searchParams.set("pageToken", pageToken);
      }

      const response = await fetch(url.toString(), {
        headers,
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        console.log(LOG_TAGS.MCP, "Activity fetch failed with status:", response.status, await response.text().catch(() => ""));
        // Stop paginating on error, but keep any data we successfully fetched
        break;
      }

      const data = await response.json();
      activities = activities.concat(data.items || []);
      pageToken = data.nextPageToken;

    } while (pageToken && activities.length < ACTIVITY_MAX_EVENTS);

    const grouped = groupByUser(activities);
    
    activityCache.set(key, { data: grouped, expiresAt: now + ACTIVITY_TTL_MS });
    return NextResponse.json({ activity: grouped });
  } catch (error) {
    /**
     * Degrade silently — activity is a nice-to-have. If the call
     * fails (credentials, quota, etc.), the selector falls back to
     * plain directory search with no badges.
     */
    console.log(LOG_TAGS.MCP, "Activity fetch failed:", getErrorMessage(error));
    return NextResponse.json({ activity: {} });
  }
}

type RawActivity = { actor?: { email?: string; profileId?: string }; id?: { time?: string } };

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
