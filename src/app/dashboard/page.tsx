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
import { InspectorPanel } from "@/components/inspector-panel";
import { ActivityRoster } from "@/components/activity-roster";
import type { InvocationPart } from "@/lib/tool-part";
import type { UserActivity } from "@/app/api/users/activity/route";
import { Wrench, Eraser } from "lucide-react";

export default function DashboardPage() {
  const [selectedUser, setSelectedUser] = useState("");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [toolInvocations, setToolInvocations] = useState<InvocationPart[]>([]);
  const [activity, setActivity] = useState<Record<string, UserActivity>>({});

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

  const toggleInspector = useCallback(() => setInspectorOpen((v) => !v), []);

  /**
   * The sidebar and the selector both use the same activity map. We
   * fetch it here so the sidebar roster and the combobox stay in sync
   * without double-fetching.
   */
  useEffect(() => {
    let cancelled = false;
    fetch("/api/users/activity")
      .then((r) => (r.ok ? r.json() : { activity: {} }))
      .then((body: { activity?: Record<string, UserActivity> }) => {
        if (cancelled) return;
        setActivity(body.activity ?? {});
      })
      .catch(() => {
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
      const search = document.getElementById("user-search");
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
    <div className="isolate flex h-dvh flex-col">
      <AppBar />

      <div className="mx-auto flex w-full max-w-[1680px] flex-1 overflow-hidden">
        <aside className="bg-surface border-on-surface/10 flex w-72 shrink-0 flex-col border-r max-md:hidden lg:w-80">
          <div className="flex flex-1 flex-col overflow-y-auto">
            <section className="flex flex-col gap-2 px-4 py-4">
              <UserSelector selectedUser={selectedUser} onUserChange={setSelectedUser} />
            </section>

            <section className="border-on-surface/10 flex flex-col gap-2 border-t px-4 py-4">
              <header className="flex items-baseline justify-between">
                <h2 className="text-on-surface text-[0.8125rem] font-medium">Recent activity</h2>
                <span className="text-on-surface-muted font-mono text-[0.625rem] tabular-nums">
                  10 days
                </span>
              </header>
              <ActivityRoster
                activity={activity}
                selectedUser={selectedUser}
                onPick={setSelectedUser}
              />
            </section>
          </div>

          <div className="border-on-surface/10 flex flex-col gap-0.5 border-t px-2 py-2">
            <button
              type="button"
              onClick={toggleInspector}
              className="state-layer text-on-surface-variant flex items-center gap-2 rounded-[var(--radius-xs)] px-2 py-1.5 text-xs"
            >
              <Wrench className="size-3.5" />
              <span>MCP inspector</span>
              {toolInvocations.length > 0 && (
                <span className="bg-primary-light text-primary ml-auto rounded-full px-1.5 py-0.5 font-mono text-[0.625rem] font-medium tabular-nums">
                  {toolInvocations.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setToolInvocations([])}
              disabled={toolInvocations.length === 0}
              className="state-layer text-on-surface-muted flex items-center gap-2 rounded-[var(--radius-xs)] px-2 py-1.5 text-xs disabled:opacity-40"
            >
              <Eraser className="size-3.5" />
              <span>Clear inspector</span>
            </button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="bg-surface border-on-surface/10 border-b p-2 md:hidden">
            <UserSelector selectedUser={selectedUser} onUserChange={setSelectedUser} />
          </div>

          <ChatPanel selectedUser={selectedUser} onToolInvocation={handleToolInvocation} />
        </div>

        <InspectorPanel
          invocations={toolInvocations}
          isOpen={inspectorOpen}
          onToggle={toggleInspector}
        />
      </div>
    </div>
  );
}
