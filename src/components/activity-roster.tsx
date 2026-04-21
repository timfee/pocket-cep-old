/**
 * @file Sidebar list of the most-active users in the last 7 days.
 *
 * Reads the same activity map the UserSelector uses. Clicking an entry
 * selects that user in the chat.
 *
 * Skeleton-with-shape: the row count is read from localStorage on cold
 * mount so the skeleton matches the previous load's size — eliminates
 * the visible "tall skeleton → shorter list" jump on page reloads.
 */

"use client";

import { useEffect } from "react";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/components/ui/skeleton";
import type { UserActivity } from "@/app/api/users/activity/route";

type ActivityRosterProps = {
  activity: Record<string, UserActivity>;
  selectedUser: string;
  isLoading?: boolean;
  onPick: (email: string) => void;
};

/**
 * Maximum number of rows shown in the rail. Capped so very large orgs
 * don't blow out the rail height; users investigate top-N anyway.
 */
const MAX_ROSTER_ROWS = 6;

/**
 * localStorage key for the cached row count. Used to pre-size the
 * skeleton on the next mount so the layout doesn't reshuffle.
 */
const ROSTER_SHAPE_KEY = "cep_roster_shape";

/**
 * Reads the cached row count synchronously so the very first render
 * uses the right shape. Falls back to MAX_ROSTER_ROWS if storage is
 * empty or unavailable, matching the historical behaviour.
 */
function readCachedRowCount(): number {
  if (typeof window === "undefined") return MAX_ROSTER_ROWS;
  try {
    const raw = window.localStorage.getItem(ROSTER_SHAPE_KEY);
    if (!raw) return MAX_ROSTER_ROWS;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return MAX_ROSTER_ROWS;
    return Math.min(parsed, MAX_ROSTER_ROWS);
  } catch {
    return MAX_ROSTER_ROWS;
  }
}

export function ActivityRoster({ activity, selectedUser, isLoading, onPick }: ActivityRosterProps) {
  const ranked = Object.entries(activity)
    .sort((a, b) => b[1].eventCount - a[1].eventCount)
    .slice(0, MAX_ROSTER_ROWS);

  /**
   * Persist the row count so the next cold load can size its skeleton
   * accordingly. Skipped during loading and when the list is empty
   * (we'd rather show the historical shape than collapse to zero).
   */
  useEffect(() => {
    if (isLoading || ranked.length === 0) return;
    try {
      window.localStorage.setItem(ROSTER_SHAPE_KEY, String(ranked.length));
    } catch {
      // ignore — preference simply won't persist
    }
  }, [isLoading, ranked.length]);

  if (isLoading) {
    const skeletonCount = readCachedRowCount();
    return (
      <div className="flex flex-col gap-0.5" aria-hidden="true">
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <div key={i} className="flex h-8 w-full items-center gap-2 px-2 py-1.5">
            <Skeleton className="size-1.5 shrink-0 rounded-full" />
            <Skeleton className="h-3 flex-1" />
            <Skeleton className="h-3 w-6 shrink-0" />
          </div>
        ))}
      </div>
    );
  }

  if (ranked.length === 0) {
    return <p className="text-on-surface-muted text-xs">No recent activity.</p>;
  }

  const maxCount = ranked[0][1].eventCount;

  return (
    <ul role="list" className="flex flex-col gap-0.5">
      {ranked.map(([email, entry]) => {
        const isSelected = email === selectedUser;
        const widthPct = Math.max(4, (entry.eventCount / maxCount) * 100);
        return (
          <li key={email}>
            <button
              type="button"
              onClick={() => onPick(email)}
              className={cn(
                "state-layer group relative flex w-full items-center gap-2 rounded-[var(--radius-xs)] px-2 py-1.5 text-left",
                isSelected && "bg-primary-light",
              )}
            >
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  isSelected ? "bg-primary" : "bg-primary/50",
                )}
                aria-hidden="true"
              />
              <span
                className={cn(
                  "min-w-0 flex-1 truncate font-mono text-xs",
                  isSelected ? "text-primary font-medium" : "text-on-surface",
                )}
              >
                {email}
              </span>
              <span className="text-on-surface-muted font-mono text-xs tabular-nums">
                {entry.eventCount}
              </span>

              <span
                className="bg-primary/25 pointer-events-none absolute bottom-0 left-0 h-px w-(--activity-bar)"
                aria-hidden="true"
                style={{ "--activity-bar": `${widthPct}%` } as React.CSSProperties}
              />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
