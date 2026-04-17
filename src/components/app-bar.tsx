/**
 * @file MD3-style top app bar.
 *
 * In user_oauth mode: shows the signed-in user's email and a sign-out button.
 * In service_account mode: shows "Service Account" with no sign-out (since
 * the session is auto-created and signing out would just re-create it).
 */

"use client";

import { authClient } from "@/lib/auth-client";
import { SA_EMAIL_DOMAIN } from "@/lib/constants";

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
        <svg
          viewBox="0 0 16 16"
          fill="currentColor"
          className="fill-primary size-4 shrink-0"
          aria-hidden="true"
        >
          <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm3.28 5.28-4 4a.75.75 0 0 1-1.06 0l-2-2a.75.75 0 1 1 1.06-1.06L6.75 8.69l3.47-3.47a.75.75 0 0 1 1.06 1.06Z" />
        </svg>
        <span className="text-on-surface font-medium">Pocket CEP</span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {isAnonymous ? (
          <span className="bg-surface-container text-on-surface-variant rounded-[var(--radius-xs)] px-2 py-0.5 text-xs font-medium">
            Service Account
          </span>
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
