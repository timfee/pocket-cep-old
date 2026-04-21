/**
 * @file Dashboard — the main authenticated interface.
 *
 * Tool invocations are upserted by `toolCallId` so state transitions
 * (input-streaming → input-available → output-available) replace the
 * existing entry in place rather than appending duplicate rows.
 */

"use client";

import { useState, useCallback, useEffect } from "react";
import { AppBar } from "@/components/app-bar";
import { UserSelector } from "@/components/user-selector";
import { ChatPanel } from "@/components/chat-panel";
import { InspectorList } from "@/components/inspector-panel";
import { ActivityRoster } from "@/components/activity-roster";
import { cn } from "@/lib/cn";
import type { InvocationPart } from "@/lib/tool-part";
import type { UserActivity } from "@/app/api/users/activity/route";
import { ACTIVITY_CACHE_KEY, SIDEBAR_COLLAPSED_KEY, USER_SEARCH_INPUT_ID } from "@/lib/constants";
import { Activity, Eraser, Wrench } from "lucide-react";

/**
 * Identifiers for the two views inside the left rail. We track this
 * as state on the dashboard so other surfaces (e.g. a future "open
 * inspector on tool call" affordance) can flip the active tab.
 */
type SidebarTab = "activity" | "inspector";

export default function DashboardPage() {
  const [selectedUser, setSelectedUser] = useState("");
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("activity");
  const [toolInvocations, setToolInvocations] = useState<InvocationPart[]>([]);
  const [activity, setActivity] = useState<Record<string, UserActivity>>({});
  const [isActivityLoading, setIsActivityLoading] = useState(true);
  /**
   * Sidebar collapse state. SSR-safe default is `false` so the server-
   * rendered markup matches the most common client state. We hydrate
   * the persisted preference from localStorage in an effect below to
   * avoid a hydration mismatch.
   */
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const toggleSidebar = useCallback(() => {
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // ignore — preference simply won't persist
      }
      return next;
    });
  }, []);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (stored === "1") setIsSidebarCollapsed(true);
    } catch {
      // ignore
    }
  }, []);

  const handleToolInvocation = useCallback((part: InvocationPart) => {
    const id = part.toolCallId;
    if (!id) return;
    setToolInvocations((prev) => {
      const idx = prev.findIndex((p) => p.toolCallId === id);
      if (idx === -1) return [...prev, part];
      if (prev[idx] === part) return prev;
      const next = prev.slice();
      next[idx] = part;
      return next;
    });
  }, []);

  /**
   * The sidebar and the selector both use the same activity map. We
   * fetch it here so the sidebar roster and the combobox stay in sync
   * without double-fetching.
   *
   * Cached in sessionStorage so navigating to/from the dashboard doesn't
   * trigger redundant expensive fetches unless the user hard-refreshes.
   */
  useEffect(() => {
    let cancelled = false;

    try {
      const cached = sessionStorage.getItem(ACTIVITY_CACHE_KEY);
      if (cached) {
        /**
         * Read-through cache: we mirror sessionStorage into React state
         * on mount. The eslint-plugin-react-hooks rule flags sync setState
         * in effects, but this is the recommended hydration pattern for
         * browser-only storage; the SSR render uses the default {} state.
         */
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setActivity(JSON.parse(cached));

        setIsActivityLoading(false);
        return;
      }
    } catch {
      // ignore parsing/storage errors
    }

    fetch("/api/users/activity")
      .then((r) => (r.ok ? r.json() : { activity: {} }))
      .then((body: { activity?: Record<string, UserActivity> }) => {
        if (cancelled) return;
        const fetchedActivity = body.activity ?? {};
        setActivity(fetchedActivity);
        setIsActivityLoading(false);
        try {
          sessionStorage.setItem(ACTIVITY_CACHE_KEY, JSON.stringify(fetchedActivity));
        } catch {
          // ignore
        }
      })
      .catch(() => {
        if (!cancelled) setIsActivityLoading(false);
        /* silent — activity is optional */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * `/` focuses the user search from anywhere on the page, as long as
   * the user isn't already typing into some other field.
   */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      ) {
        return;
      }
      const search = document.getElementById(USER_SEARCH_INPUT_ID);
      if (search instanceof HTMLInputElement) {
        e.preventDefault();
        search.focus();
        search.select();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="isolate flex min-h-0 flex-1 flex-col">
      <AppBar onToggleSidebar={toggleSidebar} isSidebarCollapsed={isSidebarCollapsed} />

      <div className="mx-auto flex w-full max-w-[1680px] flex-1 overflow-hidden">
        <aside
          id="dashboard-sidebar"
          aria-label="Investigation rail"
          hidden={isSidebarCollapsed}
          className="bg-surface border-on-surface/10 flex min-h-0 w-72 shrink-0 flex-col border-r max-md:hidden lg:w-80"
        >
          <section aria-label="User search" className="border-on-surface/10 border-b px-4 py-4">
            <UserSelector
              selectedUser={selectedUser}
              onUserChange={setSelectedUser}
              activity={activity}
            />
          </section>

          <div
            role="tablist"
            aria-label="Sidebar views"
            className="border-on-surface/10 flex shrink-0 gap-1 border-b px-2 py-2"
          >
            <SidebarTabButton
              id="tab-activity"
              panelId="panel-activity"
              isActive={sidebarTab === "activity"}
              onSelect={() => setSidebarTab("activity")}
              icon={Activity}
              label="Activity"
            />
            <SidebarTabButton
              id="tab-inspector"
              panelId="panel-inspector"
              isActive={sidebarTab === "inspector"}
              onSelect={() => setSidebarTab("inspector")}
              icon={Wrench}
              label="Inspector"
              count={toolInvocations.length}
            />
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {sidebarTab === "activity" ? (
              <section
                id="panel-activity"
                role="tabpanel"
                aria-labelledby="tab-activity"
                className="flex flex-col gap-2 px-4 py-4"
              >
                <header className="flex items-baseline justify-between">
                  <h2 id="recent-activity-heading" className="text-on-surface text-sm font-medium">
                    Recent activity
                  </h2>
                  <span className="text-on-surface-muted text-xs tabular-nums">10 days</span>
                </header>
                <ActivityRoster
                  activity={activity}
                  selectedUser={selectedUser}
                  isLoading={isActivityLoading}
                  onPick={setSelectedUser}
                />
              </section>
            ) : (
              <section
                id="panel-inspector"
                role="tabpanel"
                aria-labelledby="tab-inspector"
                className="flex flex-col gap-2 px-3 py-3"
              >
                <header className="flex items-baseline justify-between px-1">
                  <h2 className="text-on-surface text-sm font-medium">MCP inspector</h2>
                  <span className="text-on-surface-muted text-xs tabular-nums">
                    {toolInvocations.length} call{toolInvocations.length === 1 ? "" : "s"}
                  </span>
                </header>
                <InspectorList invocations={toolInvocations} />
              </section>
            )}
          </div>

          {sidebarTab === "inspector" && (
            <footer className="border-on-surface/10 border-t px-2 py-2">
              <button
                type="button"
                onClick={() => setToolInvocations([])}
                disabled={toolInvocations.length === 0}
                className="state-layer text-on-surface-variant flex w-full items-center gap-2 rounded-[var(--radius-xs)] px-2 py-1.5 text-sm disabled:opacity-40"
              >
                <Eraser className="size-4" aria-hidden="true" />
                <span>Clear invocations</span>
              </button>
            </footer>
          )}
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="bg-surface border-on-surface/10 border-b p-2 md:hidden">
            <UserSelector
              selectedUser={selectedUser}
              onUserChange={setSelectedUser}
              activity={activity}
            />
          </div>

          <ChatPanel
            selectedUser={selectedUser}
            onToolInvocation={handleToolInvocation}
            onClearSelectedUser={() => setSelectedUser("")}
          />
        </main>
      </div>
    </div>
  );
}

/**
 * Single tab in the sidebar tablist. Encapsulates ARIA wiring and the
 * optional count badge so the tablist markup stays scannable.
 */
type SidebarTabButtonProps = {
  id: string;
  panelId: string;
  isActive: boolean;
  onSelect: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count?: number;
};

function SidebarTabButton({
  id,
  panelId,
  isActive,
  onSelect,
  icon: Icon,
  label,
  count,
}: SidebarTabButtonProps) {
  return (
    <button
      type="button"
      id={id}
      role="tab"
      aria-selected={isActive}
      aria-controls={panelId}
      tabIndex={isActive ? 0 : -1}
      onClick={onSelect}
      className={cn(
        "state-layer flex flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-xs)] px-2 py-1.5 text-xs font-medium",
        isActive
          ? "bg-primary-light text-primary"
          : "text-on-surface-variant hover:text-on-surface",
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      <span>{label}</span>
      {typeof count === "number" && count > 0 && (
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[0.625rem] tabular-nums",
            isActive ? "bg-primary text-on-primary" : "bg-surface-dim text-on-surface-variant",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}
