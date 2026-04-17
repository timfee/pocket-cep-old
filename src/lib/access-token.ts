/**
 * @file Helper to retrieve the Google OAuth access token from BetterAuth.
 *
 * Extracts the token-retrieval logic that's shared across API routes.
 * In user_oauth mode, we need the user's Google token to forward to the
 * MCP server. In service_account mode, we return undefined (the MCP
 * server uses its own ADC instead).
 */

import { headers } from "next/headers";
import { getAuth } from "./auth";
import { getEnv } from "./env";
import { LOG_TAGS } from "./constants";

/**
 * Retrieves the Google OAuth access token for the current user, or
 * undefined if running in service_account mode.
 *
 * Returns undefined (rather than throwing) on failure so callers can
 * decide how to handle it.
 */
export async function getGoogleAccessToken(): Promise<string | undefined> {
  const config = getEnv();

  if (config.AUTH_MODE !== "user_oauth") {
    return undefined;
  }

  try {
    const auth = getAuth();
    const tokenResult = await auth.api.getAccessToken({
      body: { providerId: "google" },
      headers: await headers(),
    });

    // BetterAuth returns an object with accessToken. We use optional
    // chaining + a type guard rather than a cast.
    if (
      tokenResult &&
      typeof tokenResult === "object" &&
      "accessToken" in tokenResult &&
      typeof tokenResult.accessToken === "string"
    ) {
      return tokenResult.accessToken;
    }

    console.warn(LOG_TAGS.AUTH, "Token result missing accessToken field");
    return undefined;
  } catch (error) {
    console.error(LOG_TAGS.AUTH, "Failed to get Google access token:", error);
    return undefined;
  }
}
