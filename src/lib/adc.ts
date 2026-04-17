/**
 * @file Google Application Default Credentials helpers.
 *
 * Owns every call to `google-auth-library` so the rest of the app can
 * depend on a typed AuthError contract instead of OAuth error shapes.
 * Extracted out of `admin-sdk.ts` so the health probe and doctor can
 * reuse it without pulling in directory-search code.
 */

import { LOG_TAGS } from "./constants";
import { AuthError, isAuthError, toAuthError } from "./auth-errors";

/**
 * Fetches an access token from Application Default Credentials.
 *
 * Throws `AuthError` on any auth-related failure (invalid_rapt,
 * invalid_grant, missing ADC, UNAUTHENTICATED). Non-auth failures are
 * rethrown untouched so upstream code can surface them verbatim.
 */
export async function getADCToken(): Promise<string> {
  try {
    const { GoogleAuth } = await import("google-auth-library");
    const auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/admin.directory.user.readonly"],
    });
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();

    if (!tokenResponse?.token) {
      throw new AuthError({
        code: "unknown_auth",
        source: "adc",
        message: "ADC returned no access token.",
        remedy: "Run `gcloud auth application-default login` to configure credentials.",
        command: "gcloud auth application-default login",
      });
    }

    return tokenResponse.token;
  } catch (error) {
    if (isAuthError(error)) throw error;
    const classified = toAuthError(error, "adc");
    if (classified) {
      console.error(
        LOG_TAGS.AUTH,
        `ADC token fetch failed: ${classified.code} — ${classified.remedy}`,
      );
      throw classified;
    }
    throw error;
  }
}

/**
 * Reads the quota_project_id from the ADC credentials file. Falls back
 * to GOOGLE_CLOUD_QUOTA_PROJECT. Returns null if neither is set — that
 * is a soft failure, not an auth failure.
 */
export async function getQuotaProject(): Promise<string | null> {
  if (process.env.GOOGLE_CLOUD_QUOTA_PROJECT) {
    return process.env.GOOGLE_CLOUD_QUOTA_PROJECT;
  }

  try {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const { homedir } = await import("os");
    const credPath = join(homedir(), ".config", "gcloud", "application_default_credentials.json");
    const raw: unknown = JSON.parse(readFileSync(credPath, "utf-8"));
    if (raw && typeof raw === "object" && "quota_project_id" in raw) {
      const value = (raw as { quota_project_id?: unknown }).quota_project_id;
      return typeof value === "string" ? value : null;
    }
    return null;
  } catch {
    return null;
  }
}
