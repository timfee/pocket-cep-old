/**
 * @file BetterAuth API catch-all route for Next.js App Router.
 *
 * This route handles all authentication requests: sign-in, sign-out,
 * callback processing, session checks, and token endpoints. BetterAuth
 * routes them internally based on the URL path.
 *
 * The [...all] catch-all pattern means any request to /api/auth/* lands here.
 */

import { getAuth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

/**
 * Export GET and POST handlers. BetterAuth handles routing internally
 * (e.g. /api/auth/callback/google, /api/auth/get-session, etc.).
 */
export const { GET, POST } = toNextJsHandler(getAuth());
