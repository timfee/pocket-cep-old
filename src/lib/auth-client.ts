/**
 * @file BetterAuth client for browser-side authentication.
 *
 * This module creates the auth client that React components use to sign in,
 * sign out, and read session state. It communicates with the BetterAuth API
 * route at /api/auth/[...all].
 *
 * Extension point: if you add plugins to the server auth config (e.g. the
 * "organization" plugin), you'll need to add their client counterparts here
 * using the `plugins` option on createAuthClient.
 */

"use client";

import { createAuthClient } from "better-auth/react";

/**
 * The BetterAuth client instance. Provides hooks and methods for auth:
 *
 *   authClient.useSession()       — React hook for session state
 *   authClient.signIn.social()    — Trigger Google OAuth sign-in
 *   authClient.signOut()          — Sign out and clear session
 *   authClient.getAccessToken()   — Get the Google OAuth access token
 *
 * The client auto-discovers the auth API by making requests to /api/auth/*.
 */
export const authClient = createAuthClient();
