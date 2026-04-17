/**
 * @file Sidebar list of the most-active users in the last 10 days.
 *
 * Reads the same activity map the UserSelector uses and surfaces the
 * top five as a one-click roster — the "who should I look at next"
 * affordance. Clicking an entry selects that user in the chat.
 */

"use client";

import { useMemo } from "react";
import { Activity } from "lucide-react";
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
    return entries.slice(0, 5);
  }, [activity]);

  if (ranked.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <span className="eyebrow">Signals</span>
        <p className="text-on-surface-muted text-[11px] leading-4">
          No recent Chrome activity to surface. Roster fills in as audit events arrive.
        </p>
      </div>
    );
  }

  const maxCount = ranked[0][1].eventCount;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="eyebrow">Most active</span>
        <span className="text-on-surface-muted font-mono text-[10px]">10-day window</span>
      </div>
      <ul className="flex flex-col gap-0.5" role="list">
        {ranked.map(([email, entry]) => (
          <li key={email}>
            <button
              type="button"
              onClick={() => onPick(email)}
              className={cn(
                "state-layer group relative flex w-full items-center gap-2 rounded-[var(--radius-xs)] px-2 py-1.5 text-left",
                email === selectedUser && "bg-primary-light",
              )}
            >
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  email === selectedUser ? "bg-primary" : "bg-primary/60",
                )}
                aria-hidden="true"
              />
              <span
                className={cn(
                  "flex-1 truncate font-mono text-[11px]",
                  email === selectedUser ? "text-primary font-medium" : "text-on-surface",
                )}
              >
                {email}
              </span>
              <span className="text-on-surface-muted flex items-center gap-1 font-mono text-[10px] tabular-nums">
                <Activity className="size-2.5" />
                {entry.eventCount}
              </span>

              <span
                className="bg-primary/20 absolute bottom-0 left-0 h-[1px]"
                style={{ width: `${(entry.eventCount / maxCount) * 100}%` }}
                aria-hidden="true"
              />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
