/**
 * @file Sidebar list of the most-active users in the last 10 days.
 *
 * Reads the same activity map the UserSelector uses. Clicking an entry
 * selects that user in the chat.
 */

"use client";

import { useMemo } from "react";
import { cn } from "@/lib/cn";
import type { UserActivity } from "@/app/api/users/activity/route";

type ActivityRosterProps = {
  activity: Record<string, UserActivity>;
  selectedUser: string;
  onPick: (email: string) => void;
};

export function ActivityRoster({ activity, selectedUser, onPick }: ActivityRosterProps) {
  const ranked = useMemo(() => {
    const entries = Object.entries(activity);
    entries.sort((a, b) => b[1].eventCount - a[1].eventCount);
    return entries.slice(0, 6);
  }, [activity]);

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
