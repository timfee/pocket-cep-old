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
import { getErrorMessage } from "@/lib/errors";
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

  // Filter users by query.
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
    // Delay close so click on list item registers first.
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
            disabled={loading}
            placeholder={loading ? "Loading users..." : "Search by email..."}
            className="bg-surface text-on-surface placeholder:text-on-surface-muted focus:ring-primary disabled:bg-surface-container disabled:text-on-surface-muted ring-on-surface/10 w-full rounded-[var(--radius-xs)] py-1.5 pr-8 pl-3 text-xs ring-1 focus:ring-2 focus:outline-none"
          />
          <svg
            viewBox="0 0 16 16"
            fill="currentColor"
            className="text-on-surface-muted pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M9.965 11.026a5 5 0 1 1 1.06-1.06l2.755 2.754a.75.75 0 1 1-1.06 1.06l-2.755-2.754ZM10.5 7a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z"
              clipRule="evenodd"
            />
          </svg>

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
                  className={`state-layer flex cursor-pointer items-center gap-2 px-3 py-1.5 ${
                    user.email === selectedUser ? "bg-primary-light" : ""
                  }`}
                >
                  <span className="flex-1 truncate text-xs">{user.email}</span>
                  {user.eventCount > 0 && (
                    <span className="text-on-surface-muted text-[10px] tabular-nums">
                      {user.eventCount} events
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <button
          type="button"
          onClick={fetchUsers}
          disabled={loading}
          aria-label="Refresh user list"
          className="state-layer text-on-surface-variant relative rounded-[var(--radius-xs)] p-1.5 disabled:opacity-50"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" className="size-4 shrink-0">
            <path d="M13.836 2.477a.75.75 0 0 1 .75.75v3.182a.75.75 0 0 1-.75.75h-3.182a.75.75 0 0 1 0-1.5h1.37l-.84-.841a4.5 4.5 0 0 0-7.08.932.75.75 0 0 1-1.3-.75 6 6 0 0 1 9.44-1.242l.842.84V3.227a.75.75 0 0 1 .75-.75Zm-.911 7.5A.75.75 0 0 1 13.199 11a6 6 0 0 1-9.44 1.241l-.84-.84v1.371a.75.75 0 0 1-1.5 0V9.591a.75.75 0 0 1 .75-.75H5.35a.75.75 0 0 1 0 1.5H3.98l.841.841a4.5 4.5 0 0 0 7.08-.932.75.75 0 0 1 1.025-.273Z" />
          </svg>
          <span
            className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-x-1/2 -translate-y-1/2 pointer-fine:hidden"
            aria-hidden="true"
          />
        </button>
      </div>
    </div>
  );
}
