/**
 * @file Returns a map of emails → recent Chrome activity stats.
 *
 * Calls the Admin Reports API (`/admin/reports/v1/activity`) directly —
 * paginating up to ACTIVITY_MAX_EVENTS — and buckets events by
 * `actor.email`. The UserSelector uses this to pre-populate the dropdown
 * and surface users with recent activity.
 *
 * Cached in-process per caller identity with a 10-minute TTL — the log
 * rarely changes fast enough to justify a round trip on every page load.
 *
 * Auth failures return HTTP 401 with an AuthErrorPayload so the banner
 * and user-selector can surface the remedy instead of silently showing
 * empty activity.
 */

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { getGoogleAccessToken } from "@/lib/access-token";
import { getEnv } from "@/lib/env";
import { getADCToken, getQuotaProject } from "@/lib/adc";
import { isAuthError, toAuthError } from "@/lib/auth-errors";
import { LOG_TAGS } from "@/lib/constants";
import { getErrorMessage } from "@/lib/errors";

const ACTIVITY_TTL_MS = 10 * 60 * 1000;
const ACTIVITY_MAX_EVENTS = 1000;
const ACTIVITY_PAGE_SIZE = 1000;

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

  try {
    /**
     * In user_oauth mode the signed-in user's token is used. In
     * service_account mode we fall back to ADC, which throws AuthError
     * on failure — the catch below classifies it for the 401 response.
     */
    const tokenToUse = accessToken ?? (await getADCToken());

    const key = cacheKey(config.MCP_SERVER_URL, tokenToUse);
    const now = Date.now();
    const cached = activityCache.get(key);
    if (cached && cached.expiresAt > now) {
      return NextResponse.json({ activity: cached.data });
    }

    const requestHeaders: Record<string, string> = {
      Authorization: `Bearer ${tokenToUse}`,
    };

    if (!accessToken) {
      const quotaProject = await getQuotaProject();
      if (quotaProject) {
        requestHeaders["x-goog-user-project"] = quotaProject;
      }
    }

    const baseUrl = new URL(
      "https://admin.googleapis.com/admin/reports/v1/activity/users/all/applications/chrome",
    );
    baseUrl.searchParams.set("customerId", "my_customer");

    let activities: RawActivity[] = [];
    let pageToken: string | undefined;

    do {
      const remaining = ACTIVITY_MAX_EVENTS - activities.length;
      const maxResults = Math.min(remaining, ACTIVITY_PAGE_SIZE);

      const url = new URL(baseUrl.toString());
      url.searchParams.set("maxResults", String(maxResults));
      if (pageToken) {
        url.searchParams.set("pageToken", pageToken);
      }

      const response = await fetch(url.toString(), {
        headers: requestHeaders,
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        /**
         * Mid-request auth failures (token revoked between issuance and
         * this call) land here. Route them through toAuthError so the
         * banner contract stays intact.
         */
        const authErr = toAuthError(body, "admin-sdk");
        if (authErr) throw authErr;
        console.log(LOG_TAGS.USERS, "Activity fetch failed with status:", response.status, body);
        break;
      }

      const data = (await response.json()) as {
        items?: RawActivity[];
        nextPageToken?: string;
      };
      activities = activities.concat(data.items ?? []);
      pageToken = data.nextPageToken;
    } while (pageToken && activities.length < ACTIVITY_MAX_EVENTS);

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
    console.log(LOG_TAGS.USERS, "Activity fetch failed:", getErrorMessage(error));
    return NextResponse.json({ activity: {} });
  }
}

type RawActivity = {
  actor?: { email?: string; profileId?: string };
  id?: { time?: string };
};

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
