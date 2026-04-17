/**
 * @file MCP Inspector panel showing tool invocations from the AI SDK.
 */

"use client";

import { useState } from "react";
import { X } from "lucide-react";

type InspectorPanelProps = {
  invocations: unknown[];
  isOpen: boolean;
  onToggle: () => void;
};

export function InspectorPanel({ invocations, isOpen, onToggle }: InspectorPanelProps) {
  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="fixed top-14 right-3 z-10 rounded-[var(--radius-sm)] bg-zinc-900 px-2.5 py-1.5 text-[11px] text-zinc-300 shadow-[var(--shadow-elevation-2)] hover:bg-zinc-800"
      >
        MCP Inspector ({invocations.length})
      </button>
    );
  }

  return (
    <aside className="border-on-surface/10 flex w-72 shrink-0 flex-col border-l bg-zinc-900 lg:w-80">
      <div className="flex items-center justify-between border-b border-zinc-700/50 px-3 py-2">
        <div>
          <h2 className="text-xs font-medium text-zinc-100">MCP Inspector</h2>
          <p className="text-[10px] text-zinc-500">Tool invocations</p>
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-label="Close inspector"
          className="relative rounded-[var(--radius-xs)] p-1 text-zinc-400 hover:text-zinc-200"
        >
          <X className="size-3.5" />
          <span
            className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-x-1/2 -translate-y-1/2 pointer-fine:hidden"
            aria-hidden="true"
          />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {invocations.length === 0 ? (
          <p className="text-center text-[11px] text-zinc-500">
            Tool invocations will appear here as the agent calls MCP tools.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {invocations.map((inv, i) => (
              <InvocationCard key={i} invocation={inv} index={i} />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function InvocationCard({ invocation, index }: { invocation: unknown; index: number }) {
  const [expanded, setExpanded] = useState(false);

  const inv =
    invocation && typeof invocation === "object" && "toolInvocation" in invocation
      ? (
          invocation as {
            toolInvocation: { toolName: string; args: unknown; result?: unknown; state: string };
          }
        ).toolInvocation
      : null;

  if (!inv) return null;

  return (
    <div className="rounded-[var(--radius-xs)] border border-zinc-700/50 bg-zinc-800">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left"
      >
        <span className="flex-1 truncate font-mono text-[11px] text-zinc-300">{inv.toolName}</span>
        <span className="font-mono text-[9px] text-zinc-600 tabular-nums">#{index + 1}</span>
      </button>

      {expanded && (
        <div className="border-t border-zinc-700/50 p-2">
          <pre className="overflow-x-auto font-mono text-[10px] leading-4 text-zinc-400">
            {JSON.stringify({ args: inv.args, result: inv.result, state: inv.state }, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
