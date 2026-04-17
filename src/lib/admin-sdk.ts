/**
 * @file Direct Google Admin SDK Directory API client for user search.
 */

import { getErrorMessage } from "./errors";
import { LOG_TAGS } from "./constants";

/**
 * Converts a user-typed search string into Admin SDK query syntax.
 * Email-like queries use the email: prefix; plain text searches by name.
 */
export function buildAdminQuery(query: string): string {
  if (!query) return "";
  return query.includes("@") ? `email:${query}*` : query;
}

/** A user from the Google Workspace directory. */
export type DirectoryUser = {
  email: string;
  name: string;
  photoUrl?: string;
  orgUnitPath?: string;
  isAdmin?: boolean;
  suspended?: boolean;
};

/**
 * Searches the Google Workspace user directory via the Admin SDK REST API.
 *
 * Supports Admin SDK query syntax:
 *   - "email:alice*" for email prefix
 *   - Plain text for general name/email search
 *   - Empty string returns the first page of all users
 */
export async function searchUsers(
  query: string,
  accessToken?: string,
  maxResults = 20,
): Promise<DirectoryUser[]> {
  const params = new URLSearchParams({
    customer: "my_customer",
    maxResults: String(maxResults),
    orderBy: "email",
    projection: "basic",
  });

  if (query) {
    params.set("query", query);
  }

  const url = `https://admin.googleapis.com/admin/directory/v1/users?${params}`;
  const token = accessToken ?? (await getADCToken());

  if (!token) {
    console.error(LOG_TAGS.USERS, "No access token available for Admin SDK call");
    return [];
  }

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };

    /**
     * Quota project header is only needed for ADC — user OAuth tokens
     * carry their own project context. Reads from the ADC credentials
     * file or GOOGLE_CLOUD_QUOTA_PROJECT env var.
     */
    if (!accessToken) {
      const quotaProject = await getQuotaProject();
      if (quotaProject) {
        headers["x-goog-user-project"] = quotaProject;
      }
    }

    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error(LOG_TAGS.USERS, `Admin SDK users.list failed (${response.status}):`, body);
      return [];
    }

    const data = (await response.json()) as {
      users?: Array<{
        primaryEmail?: string;
        name?: { fullName?: string };
        thumbnailPhotoUrl?: string;
        orgUnitPath?: string;
        isAdmin?: boolean;
        suspended?: boolean;
      }>;
    };

    return (data.users ?? []).map((u) => ({
      email: u.primaryEmail ?? "",
      name: u.name?.fullName ?? "",
      photoUrl: u.thumbnailPhotoUrl,
      orgUnitPath: u.orgUnitPath,
      isAdmin: u.isAdmin,
      suspended: u.suspended,
    }));
  } catch (error) {
    console.error(LOG_TAGS.USERS, "Admin SDK search failed:", getErrorMessage(error));
    return [];
  }
}

/**
 * Gets an access token from Application Default Credentials.
 */
async function getADCToken(): Promise<string | null> {
  try {
    const { GoogleAuth } = await import("google-auth-library");
    const auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/admin.directory.user.readonly"],
    });
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    return tokenResponse?.token ?? null;
  } catch (error) {
    console.error(LOG_TAGS.USERS, "Failed to get ADC token:", getErrorMessage(error));
    return null;
  }
}

/**
 * Reads the quota_project_id from the ADC credentials file.
 * Falls back to GOOGLE_CLOUD_QUOTA_PROJECT env var.
 */
async function getQuotaProject(): Promise<string | null> {
  if (process.env.GOOGLE_CLOUD_QUOTA_PROJECT) {
    return process.env.GOOGLE_CLOUD_QUOTA_PROJECT;
  }

  try {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const { homedir } = await import("os");
    const credPath = join(homedir(), ".config", "gcloud", "application_default_credentials.json");
    const creds = JSON.parse(readFileSync(credPath, "utf-8"));
    return creds.quota_project_id ?? null;
  } catch {
    return null;
  }
}
