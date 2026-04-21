/**
 * @file Top command bar.
 *
 * Intentionally minimal: just the product wordmark and the session/flavor
 * chips on the right. The sidebar toggle lives in the sidebar itself
 * now — much closer to where the reader's eye is already focused — and
 * the old "Jump to user" search button was dropped in favour of the
 * sidebar's own search input.
 */

"use client";

import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { SA_EMAIL_DOMAIN } from "@/lib/constants";
import { ModeBadges } from "@/components/mode-badges";

export function AppBar() {
  const session = authClient.useSession();
  const user = session.data?.user;
  const isAnonymous = user?.email?.endsWith(`@${SA_EMAIL_DOMAIN}`);

  const handleSignOut = async () => {
    await authClient.signOut();
    window.location.href = "/";
  };

  return (
    <header className="bg-surface border-on-surface/10 relative z-10 flex h-14 shrink-0 items-center border-b px-4 sm:px-6">
      <div className="mx-auto flex w-full max-w-[1680px] items-center gap-4">
        <Link
          href="/"
          aria-label="Pocket CEP homepage"
          className="group flex shrink-0 items-center gap-2 rounded-[var(--radius-xs)]"
        >
          <span className="text-on-surface text-[0.9375rem] font-semibold tracking-tight">
            Pocket CEP
          </span>
          <span
            className="bg-on-surface/25 size-1 shrink-0 rounded-full max-lg:hidden"
            aria-hidden="true"
          />
          <span className="text-on-surface-muted truncate text-xs max-lg:hidden">
            Chrome Enterprise Premium
          </span>
        </Link>

        <nav
          aria-label="Session and configuration"
          className="ml-auto flex shrink-0 items-center gap-2"
        >
          <ModeBadges />
          <SessionChip isAnonymous={!!isAnonymous} email={user?.email} onSignOut={handleSignOut} />
        </nav>
      </div>
    </header>
  );
}

type SessionChipProps = {
  isAnonymous: boolean;
  email: string | null | undefined;
  onSignOut: () => void;
};

function SessionChip({ isAnonymous, email, onSignOut }: SessionChipProps) {
  if (isAnonymous) {
    return null;
  }

  return (
    <div className="flex items-center gap-2.5">
      {email && (
        <span className="text-on-surface-variant max-w-[20ch] truncate text-xs max-lg:hidden xl:max-w-[28ch]">
          {email}
        </span>
      )}
      <button
        type="button"
        onClick={onSignOut}
        className="state-layer bg-surface-dim text-on-surface-variant ring-on-surface/10 inline-flex h-7 items-center rounded-full px-3 text-[0.75rem] font-medium ring-1"
      >
        Sign out
      </button>
    </div>
  );
}
