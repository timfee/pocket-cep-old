/**
 * @file BetterAuth server configuration for Pocket CEP.
 *
 * Runs in stateless mode (no database) with Google OAuth as the sole
 * sign-in method. The auth mode (service_account vs user_oauth) determines
 * which Google scopes are requested during sign-in:
 *
 *   - service_account: basic scopes (openid, email, profile). The MCP
 *     server uses its own ADC for Google API calls.
 *
 *   - user_oauth: full admin scopes. The user's access token is forwarded
 *     to the MCP server as a Bearer token for every tool call.
 *
 * Extension point: to add more OAuth providers (GitHub, Microsoft, etc.),
 * add them to the socialProviders object below.
 */

import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { getEnv } from "./env";

/**
 * Basic scopes for service_account mode. The user signs in just to
 * access the Pocket CEP UI — no admin permissions needed.
 */
const BASIC_SCOPES = ["openid", "email", "profile"];

/**
 * Full admin scopes for user_oauth mode. These match what the CEP MCP
 * server needs to call Google Workspace and Chrome Management APIs.
 *
 * See: /home/feel/cmcp/lib/constants.js lines 31-44 for the upstream list.
 */
const ADMIN_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/admin.reports.audit.readonly",
  "https://www.googleapis.com/auth/chrome.management.reports.readonly",
  "https://www.googleapis.com/auth/chrome.management.profiles.readonly",
  "https://www.googleapis.com/auth/admin.directory.orgunit.readonly",
  "https://www.googleapis.com/auth/admin.directory.customer.readonly",
  "https://www.googleapis.com/auth/cloud-identity.policies",
  "https://www.googleapis.com/auth/apps.licensing",
  "https://www.googleapis.com/auth/cloud-platform",
];

/**
 * Creates the BetterAuth instance. We wrap this in a function so that
 * env validation runs lazily (not at build/type-gen time).
 */
function createAuth() {
  const config = getEnv();
  const isUserOAuth = config.AUTH_MODE === "user_oauth";

  return betterAuth({
    // No database — stateless session mode. BetterAuth encodes the session
    // into a signed cookie/token instead of storing it in a DB.

    secret: config.BETTER_AUTH_SECRET,
    baseURL: config.BETTER_AUTH_URL,

    socialProviders: {
      google: {
        clientId: config.GOOGLE_CLIENT_ID,
        clientSecret: config.GOOGLE_CLIENT_SECRET,
        // In user_oauth mode, request the full admin scope set so the
        // user's token can be forwarded to the MCP server.
        scope: isUserOAuth ? ADMIN_SCOPES : BASIC_SCOPES,
      },
    },

    // The nextCookies plugin ensures Set-Cookie headers work correctly
    // in Next.js Server Actions. Must be the last plugin in the array.
    plugins: [nextCookies()],
  });
}

/**
 * Lazy singleton — created on first access so we don't crash during
 * `next build` when env vars may not be present.
 */
let _auth: ReturnType<typeof createAuth> | null = null;

/**
 * The BetterAuth server instance. Use this in API routes and Server
 * Components to check sessions and retrieve tokens.
 *
 * Usage:
 *   import { auth } from "@/lib/auth";
 *   const session = await auth.api.getSession({ headers: await headers() });
 */
export function getAuth() {
  if (!_auth) {
    _auth = createAuth();
  }
  return _auth;
}
