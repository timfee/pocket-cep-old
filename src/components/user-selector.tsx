/**
 * @file Server-side user search combobox with debounced typeahead.
 *
 * Pre-fetches a recent-activity map on mount and uses it to:
 * - surface users with activity even before the directory search returns
 * - show a dot + event count on users with recent Chrome events
 * - rank active users above inactive ones in search results
 */

"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Search, Loader2, UserX, Check, Activity } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { getErrorMessage } from "@/lib/errors";
import type { DirectoryUser } from "@/app/api/users/route";
import type { UserActivity } from "@/app/api/users/activity/route";

type UserSelectorProps = {
  selectedUser: string;
  onUserChange: (email: string) => void;
};

type SearchState = "idle" | "loading" | "results" | "empty" | "error";
type ActivityMap = Record<string, UserActivity>;

export function UserSelector({ selectedUser, onUserChange }: UserSelectorProps) {
  const [query, setQuery] = useState(selectedUser);
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [state, setState] = useState<SearchState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activity, setActivity] = useState<ActivityMap>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const abortRef = useRef<AbortController>(null);
  const requestIdRef = useRef(0);

  const search = useCallback(async (q: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const id = ++requestIdRef.current;
    setState("loading");
    setError(null);

    try {
      const response = await fetch(`/api/users?q=${encodeURIComponent(q)}`, {
        signal: controller.signal,
      });

      if (id !== requestIdRef.current) return;

      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: "Request failed" }));
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }

      const body: unknown = await response.json();
      const list =
        body && typeof body === "object" && "users" in body && Array.isArray(body.users)
          ? (body.users as DirectoryUser[])
          : [];

      if (id !== requestIdRef.current) return;

      setUsers(list);
      setState(list.length > 0 ? "results" : "empty");
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(getErrorMessage(err));
      setState("error");
    }
  }, []);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setIsOpen(true);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), 300);
  };

  useEffect(() => {
    search("");

    let cancelled = false;
    fetch("/api/users/activity")
      .then((r) => (r.ok ? r.json() : { activity: {} }))
      .then((body: { activity?: ActivityMap }) => {
        if (cancelled) return;
        setActivity(body.activity ?? {});
      })
      .catch(() => {
        /* silent — activity is optional */
      });

    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selectUser = (email: string) => {
    onUserChange(email);
    setQuery(email);
    setIsOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (rankedUsers.length > 0) {
        selectUser(rankedUsers[0].email);
      } else if (query.includes("@")) {
        selectUser(query);
      }
    }
    if (e.key === "Escape") {
      setIsOpen(false);
    }
  };

  const handleBlur = () => {
    setTimeout(() => setIsOpen(false), 200);
  };

  /**
   * Rank so users with recent activity float to the top (more events
   * first), then directory order for everything else. When the query is
   * empty and directory results don't cover all active users, synthesize
   * minimal entries for the active-but-unseen users so admins can still
   * pick them from the initial dropdown.
   */
  const rankedUsers = useMemo<DirectoryUser[]>(() => {
    const byEmail = new Map<string, DirectoryUser>();
    for (const u of users) byEmail.set(u.email.toLowerCase(), u);

    if (!query) {
      for (const email of Object.keys(activity)) {
        if (!byEmail.has(email)) {
          byEmail.set(email, { email, name: "", suspended: false });
        }
      }
    }

    return Array.from(byEmail.values()).sort((a, b) => {
      const aCount = activity[a.email.toLowerCase()]?.eventCount ?? 0;
      const bCount = activity[b.email.toLowerCase()]?.eventCount ?? 0;
      if (aCount !== bCount) return bCount - aCount;
      return a.email.localeCompare(b.email);
    });
  }, [users, activity, query]);

  const isCredentialError =
    error &&
    (error.includes("credentials") ||
      error.includes("expired") ||
      error.includes("quota") ||
      error.includes("gcloud") ||
      error.includes("invalid_grant") ||
      error.includes("UNAUTHENTICATED"));

  return (
    <div className="relative flex flex-col gap-1.5">
      <label htmlFor="user-search" className="text-on-surface text-sm font-medium">
        Investigate user
      </label>

      <div className="relative">
        <div className="text-on-surface-muted pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2">
          {state === "loading" ? (
            <Loader2 className="spin-slow size-3.5" />
          ) : (
            <Search className="size-3.5" />
          )}
        </div>

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
          onChange={(e) => handleQueryChange(e.target.value)}
          onFocus={() => setIsOpen(true)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder="Search by email or name…"
          className="bg-surface text-on-surface placeholder:text-on-surface-muted focus:ring-primary ring-on-surface/10 w-full rounded-[var(--radius-xs)] py-2 pr-3 pl-8 text-sm ring-1 focus:ring-2 focus:outline-none"
        />

        {isOpen && (
          <div className="bg-surface ring-on-surface/10 absolute top-full left-0 z-20 mt-1 w-full overflow-hidden rounded-[var(--radius-sm)] shadow-[var(--shadow-elevation-2)] ring-1">
            {state === "loading" && users.length === 0 && <LoadingSkeleton />}

            {state === "error" && (
              <div className="px-3 py-3">
                <p className="text-error text-xs font-medium">
                  {isCredentialError ? "Credential Error" : "Search Failed"}
                </p>
                <p className="text-error/80 mt-1 text-[11px] leading-4">{error}</p>
                <button
                  type="button"
                  onMouseDown={() => search(query)}
                  className="state-layer text-primary mt-2 rounded-[var(--radius-xs)] px-2 py-1 text-xs font-medium"
                >
                  Retry
                </button>
              </div>
            )}

            {state === "empty" && rankedUsers.length === 0 && (
              <div className="flex flex-col items-center gap-1.5 px-3 py-4 text-center">
                <UserX className="text-on-surface-muted size-5" />
                <p className="text-on-surface-muted text-xs">
                  {query ? `No users matching "${query}"` : "No users found in this org"}
                </p>
              </div>
            )}

            {rankedUsers.length > 0 && (
              <ul id="user-listbox" role="listbox" className="max-h-60 overflow-y-auto py-1">
                {rankedUsers.map((user) => {
                  const act = activity[user.email.toLowerCase()];
                  return (
                    <li
                      key={user.email}
                      role="option"
                      aria-selected={user.email === selectedUser}
                      onMouseDown={() => selectUser(user.email)}
                      className={cn(
                        "state-layer flex cursor-pointer items-center gap-2 px-3 py-1.5",
                        user.email === selectedUser && "bg-primary-light",
                      )}
                    >
                      {user.email === selectedUser ? (
                        <Check className="text-primary size-3.5 shrink-0" />
                      ) : act ? (
                        <span
                          className="bg-primary size-1.5 shrink-0 rounded-full"
                          aria-label="Has recent activity"
                        />
                      ) : (
                        <span className="size-1.5 shrink-0" aria-hidden="true" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{user.email}</p>
                        {user.name && user.name !== user.email && (
                          <p className="text-on-surface-muted truncate text-xs">{user.name}</p>
                        )}
                      </div>
                      {act && (
                        <span
                          className="text-primary flex shrink-0 items-center gap-1 text-xs tabular-nums"
                          title={`${act.eventCount} recent event${act.eventCount === 1 ? "" : "s"}`}
                        >
                          <Activity className="size-3" />
                          {act.eventCount}
                        </span>
                      )}
                      {user.suspended && (
                        <span className="text-on-surface-muted text-xs">Suspended</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-2 px-3 py-3">
      <Skeleton className="h-6 w-full" />
      <Skeleton className="h-6 w-5/6" />
      <Skeleton className="h-6 w-4/6" />
      <Skeleton className="h-6 w-3/6" />
    </div>
  );
}
