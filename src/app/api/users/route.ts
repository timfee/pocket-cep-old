/**
 * @file API route to list managed Chrome users.
 *
 * Fetches from two MCP sources in parallel:
 *   1. list_customer_profiles -- all managed browser profiles (the full user list)
 *   2. get_chrome_activity_log -- recent events (annotates users with activity counts)
 *
 * This gives the frontend a complete list for autocomplete while highlighting
 * users with recent activity at the top.
 *
 * GET /api/users -> { users: [{ email, eventCount, lastActive?, source }] }
 *
 * Both MCP calls use Promise.allSettled so the endpoint still returns
 * partial data if one source fails (e.g., if the activity log API is
 * unavailable but profiles work). Only when both calls fail does the
 * endpoint return a 502.
 *
 * The response is sorted by eventCount descending so the UserSelector
 * combobox surfaces the most active (and therefore most interesting to
 * investigate) users at the top.
 *
 * Extension point: to add more user metadata (e.g., license status),
 * add another parallel MCP call and merge the results into UserEntry.
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
 * A single user entry returned to the frontend. The `source` field
 * indicates whether the user was discovered from a browser profile
 * or from activity log events, which helps the UI decide how to
 * render the entry (e.g., showing "no profile" badges).
 */
export type UserEntry = {
  email: string;
  eventCount: number;
  lastActive?: string;
  source: "profile" | "activity";
};

/**
 * Fetches the combined user list from MCP profiles and activity logs.
 * Requires an authenticated session; returns 401 otherwise.
 */
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

    return NextResponse.json(
      { error: diagnoseError(message, config.MCP_SERVER_URL) },
      { status: 502 },
    );
  }

  /**
   * Even when the MCP call "succeeds", the tool can return isError: true
   * with credential errors embedded in the content. Check for common ADC
   * failures and surface them clearly instead of showing an empty user list.
   */
  const credentialError = detectCredentialError(profilesResult, activityResult);
  if (credentialError) {
    return NextResponse.json({ error: credentialError }, { status: 502 });
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
 *
 * The MCP server returns profiles as an array of `{ text: string }` objects.
 * The text contains human-readable lines like "Email: user@example.com" as
 * well as embedded JSON with `userEmail` and `lastActivityTime` fields.
 * We parse both formats to maximize coverage -- the regex approach is
 * intentionally lenient because the MCP server's output format is not
 * formally specified and may vary between versions.
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
 *
 * Activity log entries contain "actor: user@example.com" in their text.
 * Each occurrence increments that user's event count. Exported for use
 * in tests.
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

/** Known error patterns from the MCP server that indicate credential issues. */
const CREDENTIAL_ERROR_PATTERNS = [
  "invalid_grant",
  "invalid_rapt",
  "Application Default Credentials are not set up",
  "requires a quota project",
  "insufficient authentication scopes",
  "UNAUTHENTICATED",
] as const;

/**
 * Inspects MCP tool results for credential-related errors. Returns a
 * user-friendly message if found, or null if results look normal.
 */
function detectCredentialError(
  profilesResult: PromiseSettledResult<{ content: unknown; isError: boolean }>,
  activityResult: PromiseSettledResult<{ content: unknown; isError: boolean }>,
): string | null {
  const contents: string[] = [];

  for (const result of [profilesResult, activityResult]) {
    if (result.status !== "fulfilled") continue;
    if (!result.value.isError) continue;

    const content = result.value.content;
    if (Array.isArray(content)) {
      for (const item of content) {
        if (item && typeof item === "object" && "text" in item) {
          contents.push(String(item.text));
        }
      }
    }
  }

  const allText = contents.join(" ");

  for (const pattern of CREDENTIAL_ERROR_PATTERNS) {
    if (allText.includes(pattern)) {
      return formatCredentialError(pattern);
    }
  }

  return null;
}

/**
 * Translates a raw credential error pattern into an actionable message
 * that tells the developer exactly what to do.
 */
function formatCredentialError(pattern: string): string {
  if (pattern === "invalid_grant" || pattern === "invalid_rapt") {
    return (
      "Google credentials have expired (RAPT re-authentication required). " +
      "Re-run: gcloud auth application-default login --scopes=... " +
      "(see README for the full scopes command)"
    );
  }

  if (pattern.includes("Application Default Credentials")) {
    return (
      "Google Application Default Credentials are not configured. " +
      "Run: gcloud auth application-default login --scopes=... " +
      "(see README for the full scopes command)"
    );
  }

  if (pattern.includes("quota project")) {
    return (
      "Google API requires a quota project. " +
      "Run: gcloud auth application-default set-quota-project YOUR_PROJECT_ID"
    );
  }

  if (pattern.includes("insufficient authentication scopes")) {
    return (
      "Current credentials don't have the required scopes. " +
      "Re-run: gcloud auth application-default login --scopes=... " +
      "(see README for the full scopes command)"
    );
  }

  return `Google API credential error: ${pattern}`;
}

/**
 * Translates a raw MCP error message into an actionable hint.
 */
function diagnoseError(message: string, mcpServerUrl: string): string {
  if (message.includes("fetch failed") || message.includes("ECONNREFUSED")) {
    return `MCP server is not reachable at ${mcpServerUrl}. Start it with: npm run dev:full`;
  }

  for (const pattern of CREDENTIAL_ERROR_PATTERNS) {
    if (message.includes(pattern)) {
      return formatCredentialError(pattern);
    }
  }

  return message;
}
