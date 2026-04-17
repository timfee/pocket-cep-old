/**
 * @file Dashboard — the main authenticated interface.
 */

"use client";

import { useState, useCallback } from "react";
import { AppBar } from "@/components/app-bar";
import { UserSelector } from "@/components/user-selector";
import { ChatPanel } from "@/components/chat-panel";
import { InspectorPanel } from "@/components/inspector-panel";
import type { InvocationPart } from "@/lib/tool-part";

export default function DashboardPage() {
  const [selectedUser, setSelectedUser] = useState("");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [toolInvocations, setToolInvocations] = useState<InvocationPart[]>([]);

  /**
   * Upsert by `toolCallId` — state transitions replace the row rather
   * than append. Bail out with the same array reference if the part is
   * identical, so React can skip the inspector re-render.
   */
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
              MCP Inspector
              {toolInvocations.length > 0 && (
                <span className="bg-primary-light text-primary ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums">
                  {toolInvocations.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setToolInvocations([])}
              disabled={toolInvocations.length === 0}
              className="state-layer text-on-surface-muted rounded-[var(--radius-xs)] px-2 py-1.5 text-xs disabled:opacity-40"
            >
              Clear inspector
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
