/**
 * @file MD3-style top app bar.
 *
 * 48px height, matching Google Admin Console density. Shows the product
 * name on the left and user info + sign-out on the right.
 */

"use client";

import { authClient } from "@/lib/auth-client";

/**
 * Top-level navigation bar displayed on every authenticated page.
 */
export function AppBar() {
  const session = authClient.useSession();
  const user = session.data?.user;

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
      </div>
    </header>
  );
}
