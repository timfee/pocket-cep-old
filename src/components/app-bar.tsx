/**
 * @file Top command bar.
 */

"use client";

import Link from "next/link";
import { Command, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { SA_EMAIL_DOMAIN, USER_SEARCH_INPUT_ID } from "@/lib/constants";
import { ModeBadges } from "@/components/mode-badges";

/**
 * Optional sidebar-toggle wiring. Provided by `DashboardPage` so the
 * top bar can host the rail's collapse control alongside global nav.
 * When omitted (e.g. on the landing page if it ever renders the bar),
 * the toggle simply isn't shown.
 */
type AppBarProps = {
  onToggleSidebar?: () => void;
  isSidebarCollapsed?: boolean;
};

export function AppBar({ onToggleSidebar, isSidebarCollapsed }: AppBarProps = {}) {
  const session = authClient.useSession();
  const user = session.data?.user;
  const isAnonymous = user?.email?.endsWith(`@${SA_EMAIL_DOMAIN}`);

  const handleSignOut = async () => {
    await authClient.signOut();
    window.location.href = "/";
  };

  return (
    <header className="bg-surface border-on-surface/10 relative z-10 flex h-14 shrink-0 items-center border-b px-4 sm:px-5">
      <div className="mx-auto flex w-full max-w-[1680px] items-center gap-3 sm:gap-4">
        {onToggleSidebar && (
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!isSidebarCollapsed}
            aria-controls="dashboard-sidebar"
            className="state-layer text-on-surface-variant ring-on-surface/10 hidden size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] ring-1 md:inline-flex"
          >
            {isSidebarCollapsed ? (
              <PanelLeftOpen className="size-4" aria-hidden="true" />
            ) : (
              <PanelLeftClose className="size-4" aria-hidden="true" />
            )}
          </button>
        )}

        <Link
          href="/"
          aria-label="Homepage"
          className="flex shrink-0 items-center gap-2.5 rounded-[var(--radius-xs)]"
        >
          <BrandMark />
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="text-on-surface text-[0.9375rem] font-medium tracking-tight">
              Pocket CEP
            </span>
            <span className="text-on-surface-muted truncate text-[0.6875rem] max-lg:hidden">
              Chrome Enterprise Premium
            </span>
          </div>
        </Link>

        <search
          role="search"
          aria-label="User search"
          className="hidden max-w-sm min-w-0 flex-1 md:block"
        >
          <button
            type="button"
            onClick={() => {
              const el = document.getElementById(USER_SEARCH_INPUT_ID);
              if (el instanceof HTMLInputElement) el.focus();
            }}
            className="bg-surface-dim ring-on-surface/10 hover:bg-surface-container flex h-8 w-full items-center gap-2 rounded-[var(--radius-sm)] px-3 text-left text-xs ring-1"
            aria-label="Focus user search"
          >
            <Command className="text-on-surface-muted size-3.5 shrink-0" aria-hidden="true" />
            <span className="text-on-surface-muted flex-1 truncate">Jump to user</span>
            <kbd className="bg-surface text-on-surface-variant ring-on-surface/10 shrink-0 rounded-[var(--radius-xs)] px-1.5 py-0.5 font-mono text-[0.625rem] ring-1">
              /
            </kbd>
          </button>
        </search>

        <nav
          aria-label="Session and configuration"
          className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3"
        >
          <ModeBadges />
          <SessionChip isAnonymous={!!isAnonymous} email={user?.email} onSignOut={handleSignOut} />
        </nav>
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
      {email && (
        <span className="text-on-surface-variant max-w-[16ch] truncate text-xs max-lg:hidden xl:max-w-[28ch] xl:text-sm">
          {email}
        </span>
      )}
      <button
        type="button"
        onClick={onSignOut}
        className="state-layer bg-surface-dim text-on-surface-variant ring-on-surface/10 inline-flex h-8 items-center rounded-[var(--radius-sm)] px-3 text-xs font-medium ring-1"
      >
        Sign out
      </button>
    </div>
  );
}
