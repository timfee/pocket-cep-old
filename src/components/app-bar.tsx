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
      <div className="mx-auto flex w-full max-w-[1680px] items-center gap-6">
        <Link
          href="/"
          aria-label="Pocket CEP homepage"
          className="flex shrink-0 flex-col justify-center leading-none"
        >
          <span className="text-on-surface text-[0.9375rem] font-semibold tracking-tight">
            Pocket CEP
          </span>
          <span className="text-on-surface-muted mt-0.5 text-[0.625rem] font-medium tracking-wide uppercase max-lg:hidden">
            Chrome Enterprise Premium
          </span>
        </Link>

        <nav
          aria-label="Session and configuration"
          className="ml-auto flex shrink-0 items-center gap-3"
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
        <span className="text-on-surface-muted max-w-[20ch] truncate text-xs max-lg:hidden xl:max-w-[28ch]">
          {email}
        </span>
      )}
      <button
        type="button"
        onClick={onSignOut}
        className="text-on-surface-muted hover:text-on-surface hover:bg-surface-dim inline-flex h-8 items-center rounded-[var(--radius-sm)] px-2.5 text-[0.8125rem] font-medium"
      >
        Sign out
      </button>
    </div>
  );
}
