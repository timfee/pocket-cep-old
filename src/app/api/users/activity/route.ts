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

import { NextResponse } from "next/server";
import { getGoogleAccessToken } from "@/lib/access-token";
import { getEnv } from "@/lib/env";
import { getADCToken, buildGoogleApiHeaders } from "@/lib/adc";
import { isAuthError, toAuthError } from "@/lib/auth-errors";
import { buildCallerCacheKey } from "@/lib/cache-key";
import { requireSession } from "@/lib/session";
import { LOG_TAGS } from "@/lib/constants";
import { getErrorMessage } from "@/lib/errors";

const ACTIVITY_TTL_MS = 10 * 60 * 1000;

/**
 * Cap on total events fetched per cache refresh. The sidebar only shows
 * the top few users, so 250 events is plenty to rank them — larger caps
 * just burned quota on the cold-cache path without changing the UI.
 */
const ACTIVITY_MAX_EVENTS = 250;
const ACTIVITY_PAGE_SIZE = 250;

/**
 * Per-user activity summary: event count and most recent event timestamp.
 */
export type UserActivity = {
  eventCount: number;
  lastEventAt?: string;
};

const activityCache = new Map<string, { data: Record<string, UserActivity>; expiresAt: number }>();

export async function GET() {
  if (!(await requireSession())) {
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

    const key = buildCallerCacheKey(config.MCP_SERVER_URL, tokenToUse);
    const now = Date.now();
    const cached = activityCache.get(key);
    if (cached && cached.expiresAt > now) {
      return NextResponse.json({ activity: cached.data });
    }

    const requestHeaders = await buildGoogleApiHeaders(tokenToUse, !accessToken);

    const baseUrl = new URL(
      "https://admin.googleapis.com/admin/reports/v1/activity/users/all/applications/chrome",
    );
    baseUrl.searchParams.set("customerId", "my_customer");

    const activities: RawActivity[] = [];
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
      if (data.items?.length) activities.push(...data.items);
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
