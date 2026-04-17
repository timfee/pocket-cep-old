/**
 * @file Dashboard — the main authenticated interface.
 *
 * Three-panel layout: sidebar (user selection), center (chat), right
 * (MCP inspector). Sidebar collapses on mobile with the user selector
 * repositioned above the chat.
 *
 * Data flow:
 *   DashboardPage (state owner)
 *     -> selectedUser flows down to UserSelector + ChatPanel
 *     -> protocolEvents flows down to InspectorPanel
 *     -> ChatPanel calls onProtocolEvent to push MCP traffic upward
 *
 * State is lifted to this page because the inspector and chat panels
 * are siblings that both need access to protocol events. The user
 * selector appears in two DOM locations (sidebar on desktop, inline
 * on mobile) but shares the same lifted state via props.
 *
 * Extension point: to add a tools catalog panel, add another aside
 * and feed it the MCP tool list from a new shared state variable.
 */

"use client";

import { useState, useCallback } from "react";
import { AppBar } from "@/components/app-bar";
import { UserSelector } from "@/components/user-selector";
import { ChatPanel } from "@/components/chat-panel";
import { InspectorPanel } from "@/components/inspector-panel";
import type { AgentEvent } from "@/lib/agent-loop";

/**
 * Top-level authenticated page. Owns all cross-panel state (selected
 * user, protocol events, inspector visibility) and distributes it via
 * props rather than context to keep the dependency graph explicit.
 */
export default function DashboardPage() {
  const [selectedUser, setSelectedUser] = useState("");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [protocolEvents, setProtocolEvents] = useState<AgentEvent[]>([]);

  /** Appends an event to the inspector log. Stable ref via useCallback. */
  const handleProtocolEvent = useCallback((event: AgentEvent) => {
    setProtocolEvents((prev) => [...prev, event]);
  }, []);

  const toggleInspector = useCallback(() => setInspectorOpen((v) => !v), []);

  return (
    <div className="isolate flex h-dvh flex-col">
      <AppBar />

      <div className="flex flex-1 overflow-hidden">
        <aside className="bg-surface border-on-surface/10 flex shrink-0 flex-col gap-3 border-r p-3 max-md:hidden md:w-64 lg:w-72">
          <UserSelector selectedUser={selectedUser} onUserChange={setSelectedUser} />

          <div className="border-on-surface/10 mt-auto flex flex-col gap-1 border-t pt-3">
            <button
              type="button"
              onClick={toggleInspector}
              className="state-layer text-on-surface-variant flex items-center gap-2 rounded-[var(--radius-xs)] px-2 py-1.5 text-xs"
            >
              <svg viewBox="0 0 16 16" fill="currentColor" className="size-4 shrink-0">
                <path
                  fillRule="evenodd"
                  d="M6.332 3.915C7.084 3.34 8.226 3 9.5 3c1.274 0 2.416.34 3.168.915.37.283.64.61.808.972.168.36.274.823.274 1.363v.5a.75.75 0 0 1-1.5 0v-.5c0-.333-.066-.553-.137-.706a1.257 1.257 0 0 0-.442-.528C11.18 4.646 10.426 4.5 9.5 4.5c-.926 0-1.68.146-2.171.516a1.257 1.257 0 0 0-.442.528c-.071.153-.137.373-.137.706a.75.75 0 0 1-1.5 0v-.5c0-.54.106-1.003.274-1.363.169-.363.438-.69.808-.972ZM9.5 8a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5ZM6.75 9.25a2.75 2.75 0 1 1 5.5 0 2.75 2.75 0 0 1-5.5 0Z"
                  clipRule="evenodd"
                />
                <path
                  fillRule="evenodd"
                  d="M1 4.75C1 3.784 1.784 3 2.75 3h10.5c.966 0 1.75.784 1.75 1.75v6.5A1.75 1.75 0 0 1 13.25 13H2.75A1.75 1.75 0 0 1 1 11.25v-6.5Zm1.75-.25a.25.25 0 0 0-.25.25v6.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25v-6.5a.25.25 0 0 0-.25-.25H2.75Z"
                  clipRule="evenodd"
                />
              </svg>
              MCP Inspector
              {protocolEvents.length > 0 && (
                <span className="bg-primary-light text-primary ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums">
                  {protocolEvents.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setProtocolEvents([])}
              disabled={protocolEvents.length === 0}
              className="state-layer text-on-surface-muted rounded-[var(--radius-xs)] px-2 py-1.5 text-xs disabled:opacity-40"
            >
              Clear inspector
            </button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Mobile user selector — shares state with sidebar instance via lifted props.
              CSS max-md:hidden/md:hidden ensures only one is visible at a time, but
              both mount. The UserSelector deduplicates fetches via its loading state. */}
          <div className="bg-surface border-on-surface/10 border-b p-2 md:hidden">
            <UserSelector selectedUser={selectedUser} onUserChange={setSelectedUser} />
          </div>

          <ChatPanel selectedUser={selectedUser} onProtocolEvent={handleProtocolEvent} />
        </div>

        <InspectorPanel events={protocolEvents} isOpen={inspectorOpen} onToggle={toggleInspector} />
      </div>
    </div>
  );
}
