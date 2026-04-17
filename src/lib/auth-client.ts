/**
 * @file BetterAuth client for browser-side authentication.
 *
 * Includes the anonymous client plugin so SA mode can create sessions
 * without OAuth. In user_oauth mode, signIn.social() triggers Google OAuth.
 */

"use client";

import { createAuthClient } from "better-auth/react";
import { anonymousClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [anonymousClient()],
});
