/**
 * @file MCP Inspector panel showing tool invocations from the AI SDK.
 */

"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, X, Wrench } from "lucide-react";
import { getToolName } from "ai";
import { cn } from "@/lib/cn";
import { toolPartLabel, type InvocationPart } from "@/lib/tool-part";

type InspectorPanelProps = {
  invocations: InvocationPart[];
  isOpen: boolean;
  onToggle: () => void;
};

export function InspectorPanel({ invocations, isOpen, onToggle }: InspectorPanelProps) {
  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="bg-surface ring-on-surface/10 text-on-surface-variant hover:bg-surface-dim fixed top-14 right-3 z-10 flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-[11px] shadow-[var(--shadow-elevation-2)] ring-1"
      >
        <Wrench className="size-3.5" />
        Inspector ({invocations.length})
      </button>
    );
  }

  return (
    <aside className="bg-surface border-on-surface/10 flex w-72 shrink-0 flex-col border-l lg:w-80">
      <div className="border-on-surface/10 flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Wrench className="text-primary size-3.5" />
          <h2 className="text-on-surface text-xs font-semibold">MCP Inspector</h2>
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-label="Close inspector"
          className="state-layer text-on-surface-variant hover:text-on-surface rounded-[var(--radius-xs)] p-1"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {invocations.length === 0 ? (
          <p className="text-on-surface-muted px-2 py-3 text-center text-[11px]">
            Tool invocations will appear here as the agent calls MCP tools.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {invocations.map((inv, i) => (
              <InvocationCard key={inv.toolCallId ?? i} invocation={inv} index={i} />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function InvocationCard({ invocation, index }: { invocation: InvocationPart; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const label = toolPartLabel(invocation.state);
  const badgeClass =
    label === "ERROR"
      ? "bg-error/20 text-error"
      : label === "DONE"
        ? "bg-success/20 text-green-700"
        : "bg-primary/20 text-primary";

  return (
    <div className="bg-surface-dim ring-on-surface/10 rounded-[var(--radius-sm)] ring-1">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="state-layer flex w-full items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-left"
      >
        {expanded ? (
          <ChevronDown className="text-on-surface-muted size-3" />
        ) : (
          <ChevronRight className="text-on-surface-muted size-3" />
        )}
        <span className="text-on-surface flex-1 truncate font-mono text-[11px]">
          {getToolName(invocation)}
        </span>
        <span
          className={cn("rounded-[2px] px-1 py-0.5 font-mono text-[9px] font-semibold", badgeClass)}
        >
          {label}
        </span>
        <span className="text-on-surface-muted font-mono text-[9px] tabular-nums">
          #{index + 1}
        </span>
      </button>

      {expanded && (
        <div className="border-on-surface/10 border-t p-2">
          <pre className="bg-surface-container text-on-surface-variant overflow-x-auto rounded-[var(--radius-xs)] p-2 font-mono text-[10px] leading-4">
            {JSON.stringify(
              {
                toolCallId: invocation.toolCallId,
                state: invocation.state,
                input: invocation.input,
                output: "output" in invocation ? invocation.output : undefined,
                errorText: "errorText" in invocation ? invocation.errorText : undefined,
              },
              null,
              2,
            )}
          </pre>
        </div>
      )}
    </div>
  );
}
