/**
 * @file Top command bar.
 *
 * Structural role: anchors the brand, surfaces the environment context,
 * and hosts global session controls. The center area carries a keyboard
 * hint pointing at the user search — the primary command for this tool.
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
    <header className="bg-surface border-on-surface/10 relative z-10 flex h-14 shrink-0 items-center gap-5 border-b px-5 shadow-[0_1px_0_0_rgb(11_18_32_/_0.02)]">
      <div className="flex items-center gap-2.5">
        <BrandMark />
        <div className="flex items-baseline gap-2 leading-none">
          <span className="text-on-surface text-[15px] font-medium tracking-tight">Pocket CEP</span>
          <span className="text-on-surface-muted text-[11px]">Chrome Enterprise Premium</span>
        </div>
      </div>

      <div className="border-on-surface/10 hidden h-6 border-l sm:block" aria-hidden="true" />

      <button
        type="button"
        onClick={() => {
          const el = document.getElementById("user-search");
          if (el instanceof HTMLInputElement) el.focus();
        }}
        className="bg-surface-dim ring-on-surface/10 hover:bg-surface-container group relative hidden h-8 min-w-[260px] items-center gap-2 rounded-[var(--radius-sm)] px-3 text-left text-xs ring-1 transition-colors md:flex"
        aria-label="Focus user search"
      >
        <Command className="text-on-surface-muted size-3.5" />
        <span className="text-on-surface-muted flex-1">Jump to user…</span>
        <kbd className="bg-surface text-on-surface-variant ring-on-surface/10 rounded-[var(--radius-xs)] px-1.5 py-0.5 font-mono text-[10px] ring-1">
          /
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-3">
        <SessionChip isAnonymous={!!isAnonymous} email={user?.email} onSignOut={handleSignOut} />
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
    return (
      <div className="bg-surface-dim ring-on-surface/10 flex items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-1 ring-1">
        <span className="bg-warning pulse-dot size-1.5 rounded-full" aria-hidden="true" />
        <div className="flex flex-col leading-tight">
          <span className="text-on-surface text-[11px] font-medium">Service account</span>
          <span className="eyebrow leading-none">no sign-in</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {email && (
        <div className="flex flex-col items-end leading-tight max-sm:hidden">
          <span className="text-on-surface text-[11px] font-medium">{email}</span>
          <span className="eyebrow leading-none">signed in</span>
        </div>
      )}
      <button
        type="button"
        onClick={onSignOut}
        className="state-layer bg-surface-dim text-on-surface-variant ring-on-surface/10 hover:text-on-surface rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium ring-1"
      >
        Sign out
      </button>
    </div>
  );
}
