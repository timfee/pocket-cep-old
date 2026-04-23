/**
 * @file Top command bar.
 *
 * Intentionally minimal: just the product wordmark and the session/flavor
 * chips on the right. The sidebar toggle lives in the sidebar itself
 * now — much closer to where the reader's eye is already focused — and
 * the old "Jump to user" search button was dropped in favour of the
 * sidebar's own search input.
 */

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
          className="flex shrink-0 items-center gap-3"
        >
          <span className="text-on-surface text-base font-semibold tracking-tight">
            Pocket{" "}
            <span className="from-primary to-primary/70 bg-linear-to-br bg-clip-text text-transparent">
              CEP
            </span>
          </span>
          <span className="bg-on-surface/10 h-4 w-px shrink-0 max-lg:hidden" aria-hidden="true" />
          <span className="text-on-surface-variant text-[0.8125rem] max-lg:hidden">
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

      {/* Whisper-thin gradient strip along the bar's bottom edge — feels more
          intentional than a flat 1px border without overpowering the chrome. */}
      <div
        aria-hidden="true"
        className="from-primary/0 via-primary/20 to-primary/0 pointer-events-none absolute inset-x-0 -bottom-px h-px bg-linear-to-r"
      />
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
