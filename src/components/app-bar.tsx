/**
 * @file MD3-style top app bar.
 *
 * In user_oauth mode: shows the signed-in user's email and a sign-out button.
 * In service_account mode: shows "Service Account" with no sign-out (since
 * the session is auto-created and signing out would just re-create it).
 *
 * The anonymous-session detection works by checking the email domain:
 * BetterAuth's anonymous plugin generates emails like `anon_xyz@service-account.local`.
 * This is cheaper than an extra API call and works offline.
 *
 * Sign-out uses a full page navigation (`window.location.href = "/"`) rather
 * than a client-side router push because BetterAuth needs the cookie to be
 * fully cleared before the landing page renders, and a hard navigation
 * guarantees the middleware re-evaluates the session.
 */

"use client";

import { Shield } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { SA_EMAIL_DOMAIN } from "@/lib/constants";
import { Badge } from "@/components/ui/badge";

/**
 * Top app bar displaying the current auth state. Adapts its content
 * based on whether the session is an anonymous service-account session
 * or a real Google OAuth session. Styled after Google Cloud Console's
 * header with a product icon, separator, and user section.
 */
export function AppBar() {
  const session = authClient.useSession();
  const user = session.data?.user;
  const isAnonymous = user?.email?.endsWith(`@${SA_EMAIL_DOMAIN}`);

  const handleSignOut = async () => {
    await authClient.signOut();
    window.location.href = "/";
  };

  return (
    <header className="bg-surface border-on-surface/10 flex h-12 items-center gap-4 border-b px-4">
      <div className="flex items-center gap-2">
        <Shield className="text-primary size-4 shrink-0" aria-hidden="true" />
        <span className="text-on-surface font-medium">Pocket CEP</span>
      </div>

      {/** Vertical separator mirrors Google Cloud Console's divider between product name and controls. */}
      <div className="border-on-surface/10 h-5 border-l" aria-hidden="true" />

      <div className="ml-auto flex items-center gap-2">
        {isAnonymous ? (
          <Badge variant="muted">Service Account</Badge>
        ) : (
          <>
            {user && (
              <span className="text-on-surface-variant text-xs max-sm:hidden">{user.email}</span>
            )}
            <button
              type="button"
              onClick={handleSignOut}
              className="state-layer text-on-surface-variant rounded-[var(--radius-xs)] px-3 py-1 text-xs font-medium"
            >
              Sign out
            </button>
          </>
        )}
      </div>
    </header>
  );
}
