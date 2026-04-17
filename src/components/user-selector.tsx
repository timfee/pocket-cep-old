/**
 * @file Autocomplete combobox for selecting a user to investigate.
 *
 * Pre-loads all managed Chrome users from /api/users (profiles + activity).
 * Users with recent activity appear first. Typing filters the list by email.
 * You can also type any email manually for users not in the list.
 *
 * Auto-selects the first user on initial load so the chat panel is
 * immediately ready. This avoids a "select a user first" dead state
 * that confused testers in early prototypes.
 *
 * The combobox follows WAI-ARIA combobox patterns: role="combobox" on
 * the input, role="listbox" on the dropdown, aria-expanded, and
 * aria-autocomplete="list". Keyboard navigation supports Enter (select
 * first match or typed email) and Escape (close dropdown).
 *
 * The blur handler uses a 200ms setTimeout to let click events on
 * list items fire before the dropdown closes. This is a common pattern
 * for comboboxes without a portal-based dropdown.
 *
 * This component renders in two places on the dashboard (sidebar +
 * mobile header) but they share lifted state via props, so selecting
 * a user in either location updates both.
 */

"use client";

import { useState, useEffect, useRef } from "react";
import { Search, RefreshCw, Check, UserX } from "lucide-react";
import { cn } from "@/lib/cn";
import { getErrorMessage } from "@/lib/errors";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import type { UserEntry } from "@/app/api/users/route";

type UserSelectorProps = {
  selectedUser: string;
  onUserChange: (email: string) => void;
};

/**
 * Autocomplete combobox for picking a Chrome user to investigate.
 * Fetches the user list from /api/users on mount and auto-selects
 * the most active user.
 */
export function UserSelector({ selectedUser, onUserChange }: UserSelectorProps) {
  const [users, setUsers] = useState<UserEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState(selectedUser);
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const fetchUsers = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/users");
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error ?? "Failed to fetch users");
      }
      const data = (await response.json()) as { users: UserEntry[] };
      setUsers(data.users);

      if (!selectedUser && data.users.length > 0) {
        onUserChange(data.users[0].email);
        setQuery(data.users[0].email);
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Filter users by query — case-insensitive substring match on email. */
  const filtered = query
    ? users.filter((u) => u.email.toLowerCase().includes(query.toLowerCase()))
    : users;

  const selectUser = (email: string) => {
    onUserChange(email);
    setQuery(email);
    setIsOpen(false);
  };

  const handleInputChange = (value: string) => {
    setQuery(value);
    setIsOpen(true);
  };

  const handleBlur = () => {
    /**
     * Delay closing so that mousedown on a list item registers
     * before the dropdown unmounts. Without this, clicks on
     * options would be swallowed by the blur event.
     */
    setTimeout(() => setIsOpen(false), 200);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (filtered.length > 0) {
        selectUser(filtered[0].email);
      } else if (query.includes("@")) {
        selectUser(query);
      }
    }
    if (e.key === "Escape") {
      setIsOpen(false);
    }
  };

  if (error) {
    const isCredentialError =
      error.includes("credentials") ||
      error.includes("expired") ||
      error.includes("quota") ||
      error.includes("gcloud");

    return (
      <div className="flex flex-col gap-2">
        <label className="text-on-surface text-xs font-medium">Investigate user</label>
        <div className="bg-error-light text-error ring-error/20 rounded-[var(--radius-sm)] px-3 py-2.5 text-xs leading-5 ring-1">
          <p className="font-medium">
            {isCredentialError ? "Credential Error" : "Connection Error"}
          </p>
          <p className="text-error/80 mt-1">{error}</p>
        </div>
        <button
          type="button"
          onClick={fetchUsers}
          className="state-layer text-primary self-start rounded-[var(--radius-xs)] px-2 py-1 text-xs font-medium"
        >
          Retry
        </button>
      </div>
    );
  }

  /**
   * Staggered-width skeletons approximate a user list while loading.
   * Varying widths prevent the "barcode" look that uniform skeletons create.
   */
  if (loading) {
    return (
      <div className="flex flex-col gap-1.5">
        <label className="text-on-surface text-xs font-medium">Investigate user</label>
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-7 w-full" />
          <Skeleton className="h-7 w-5/6" />
          <Skeleton className="h-7 w-4/6" />
          <Skeleton className="h-7 w-3/6" />
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col gap-1.5">
      <label htmlFor="user-search" className="text-on-surface text-xs font-medium">
        Investigate user
      </label>

      <div className="flex items-center gap-1.5">
        <div className="relative flex-1">
          <input
            ref={inputRef}
            id="user-search"
            type="text"
            name="selectedUser"
            role="combobox"
            aria-expanded={isOpen}
            aria-autocomplete="list"
            aria-controls="user-listbox"
            value={query}
            onChange={(e) => handleInputChange(e.target.value)}
            onFocus={() => setIsOpen(true)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            placeholder="Search by email..."
            className="bg-surface text-on-surface placeholder:text-on-surface-muted focus:ring-primary ring-on-surface/10 w-full rounded-[var(--radius-xs)] py-1.5 pr-8 pl-3 text-xs ring-1 focus:ring-2 focus:outline-none"
          />
          <Search
            className="text-on-surface-muted pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2"
            aria-hidden="true"
          />

          {isOpen && filtered.length > 0 && (
            <ul
              ref={listRef}
              id="user-listbox"
              role="listbox"
              className="bg-surface ring-on-surface/10 absolute top-full left-0 z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-[var(--radius-sm)] py-1 shadow-[var(--shadow-elevation-2)] ring-1"
            >
              {filtered.map((user) => (
                <li
                  key={user.email}
                  role="option"
                  aria-selected={user.email === selectedUser}
                  onMouseDown={() => selectUser(user.email)}
                  className={cn(
                    "state-layer slide-up flex cursor-pointer items-center gap-2 px-3 py-1.5",
                    user.email === selectedUser && "bg-primary-light",
                  )}
                >
                  {user.email === selectedUser && (
                    <Check className="text-primary size-3.5 shrink-0" aria-hidden="true" />
                  )}
                  <span className="flex-1 truncate text-xs">{user.email}</span>
                  {user.eventCount > 0 && <Badge variant="muted">{user.eventCount} events</Badge>}
                </li>
              ))}
            </ul>
          )}

          {isOpen && query && filtered.length === 0 && (
            <div className="bg-surface ring-on-surface/10 absolute top-full left-0 z-20 mt-1 flex w-full flex-col items-center gap-1.5 rounded-[var(--radius-sm)] px-3 py-4 shadow-[var(--shadow-elevation-2)] ring-1">
              <UserX className="text-on-surface-muted size-5" aria-hidden="true" />
              <span className="text-on-surface-muted text-xs">No users found</span>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={fetchUsers}
          disabled={loading}
          aria-label="Refresh user list"
          className="state-layer text-on-surface-variant relative rounded-[var(--radius-xs)] p-1.5 disabled:opacity-50"
        >
          <RefreshCw className={cn("size-4 shrink-0", loading && "spin-slow")} aria-hidden="true" />
          {/**
           * Invisible touch-target expander for mobile devices.
           * pointer-fine:hidden hides it on desktop where precise
           * cursors don't need oversized hit areas.
           */}
          <span
            className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-x-1/2 -translate-y-1/2 pointer-fine:hidden"
            aria-hidden="true"
          />
        </button>
      </div>
    </div>
  );
}
