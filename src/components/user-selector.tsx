/**
 * @file Dropdown to select a user for investigation.
 *
 * Fetches the list of users from /api/users and displays them in
 * an MD3-styled select. The selected user's email is passed to the
 * chat agent as context.
 */

"use client";

import { useState, useEffect } from "react";
import { getErrorMessage } from "@/lib/errors";

type UserEntry = {
  email: string;
  eventCount: number;
};

type UserSelectorProps = {
  selectedUser: string;
  onUserChange: (email: string) => void;
};

export function UserSelector({ selectedUser, onUserChange }: UserSelectorProps) {
  const [users, setUsers] = useState<UserEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  if (error) {
    return (
      <div className="flex flex-col gap-1.5">
        <label className="text-on-surface text-xs font-medium">Investigate user</label>
        <div className="bg-error-light text-error ring-error/20 rounded-[var(--radius-xs)] px-3 py-2 text-xs ring-1">
          {error}
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
    <div className="flex flex-col gap-1.5">
      <label htmlFor="user-select" className="text-on-surface text-xs font-medium">
        Investigate user
      </label>

      <div className="flex items-center gap-1.5">
        <div className="inline-grid flex-1 grid-cols-[1fr_--spacing(8)]">
          <select
            id="user-select"
            value={selectedUser}
            onChange={(e) => onUserChange(e.target.value)}
            disabled={loading}
            name="selectedUser"
            className="bg-surface text-on-surface focus:ring-primary disabled:bg-surface-container disabled:text-on-surface-muted ring-on-surface/10 col-span-full row-start-1 w-full appearance-none rounded-[var(--radius-xs)] py-1.5 pr-8 pl-3 text-xs ring-1 focus:ring-2 focus:outline-none"
          >
            {loading && <option value="">Loading users...</option>}
            {!loading && users.length === 0 && (
              <option value="">No users with recent events</option>
            )}
            {users.map((user) => (
              <option key={user.email} value={user.email}>
                {user.email} ({user.eventCount} events)
              </option>
            ))}
          </select>
          <svg
            viewBox="0 0 8 5"
            width="8"
            height="5"
            fill="none"
            className="pointer-events-none col-start-2 row-start-1 place-self-center"
            aria-hidden="true"
          >
            <path d="M.5.5 4 4 7.5.5" stroke="currentcolor" />
          </svg>
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
