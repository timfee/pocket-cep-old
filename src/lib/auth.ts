/**
 * @file BetterAuth server configuration.
 *
 * Two auth modes:
 *   - service_account: anonymous plugin auto-creates sessions with a fixed
 *     identity. No Google sign-in required. MCP server uses its own ADC.
 *   - user_oauth: Google OAuth with full admin scopes. The user's token
 *     is forwarded to the MCP server as a Bearer header.
 */

import { betterAuth } from "better-auth";
import { anonymous } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { getEnv } from "./env";
import { SA_EMAIL_DOMAIN } from "./constants";

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

function createAuth() {
  const config = getEnv();
  const isSA = config.AUTH_MODE === "service_account";

  return betterAuth({
    secret: config.BETTER_AUTH_SECRET,
    baseURL: config.BETTER_AUTH_URL,

    socialProviders: isSA
      ? {}
      : {
          google: {
            clientId: config.GOOGLE_CLIENT_ID,
            clientSecret: config.GOOGLE_CLIENT_SECRET,
            scope: ADMIN_SCOPES,
          },
        },

    plugins: [...(isSA ? [anonymous({ emailDomainName: SA_EMAIL_DOMAIN })] : []), nextCookies()],
  });
}

let _auth: ReturnType<typeof createAuth> | null = null;

export function getAuth() {
  if (!_auth) {
    _auth = createAuth();
  }
  return _auth;
}
