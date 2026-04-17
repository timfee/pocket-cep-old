/**
 * @file Top command bar.
 */

"use client";

import { Command } from "lucide-react";
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
    <header className="bg-surface border-on-surface/10 relative z-10 flex h-14 shrink-0 items-center gap-4 border-b px-5">
      <div className="mx-auto flex w-full max-w-[1680px] items-center gap-4">
        <div className="flex items-center gap-2.5">
          <BrandMark />
          <div className="flex items-baseline gap-2">
            <span className="text-on-surface text-[0.9375rem] font-medium tracking-tight">
              Pocket CEP
            </span>
            <span className="text-on-surface-muted text-[0.6875rem] max-sm:hidden">
              Chrome Enterprise Premium
            </span>
          </div>
        </div>

        <div className="border-on-surface/10 hidden h-6 border-l sm:block" aria-hidden="true" />

        <button
          type="button"
          onClick={() => {
            const el = document.getElementById("user-search");
            if (el instanceof HTMLInputElement) el.focus();
          }}
          className="bg-surface-dim ring-on-surface/10 hover:bg-surface-container group relative hidden h-8 min-w-[280px] items-center gap-2 rounded-[var(--radius-sm)] px-3 text-left text-xs ring-1 md:flex"
          aria-label="Focus user search"
        >
          <Command className="text-on-surface-muted size-3.5" />
          <span className="text-on-surface-muted flex-1">Jump to user</span>
          <kbd className="bg-surface text-on-surface-variant ring-on-surface/10 rounded-[var(--radius-xs)] px-1.5 py-0.5 font-mono text-[0.625rem] ring-1">
            /
          </kbd>
        </button>

        <div className="ml-auto flex items-center gap-3">
          <SessionChip isAnonymous={!!isAnonymous} email={user?.email} onSignOut={handleSignOut} />
        </div>
      </div>
    </header>
  );
}

function BrandMark() {
  return (
    <span
      aria-hidden="true"
      className="bg-primary text-on-primary relative grid size-7 place-items-center rounded-[var(--radius-xs)] shadow-[var(--shadow-elevation-1)]"
    >
      <span className="text-base leading-none font-medium">P</span>
    </span>
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
      {email && <span className="text-on-surface-variant text-sm max-sm:hidden">{email}</span>}
      <button
        type="button"
        onClick={onSignOut}
        className="state-layer bg-surface-dim text-on-surface-variant ring-on-surface/10 rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium ring-1"
      >
        Sign out
      </button>
    </div>
  );
}
