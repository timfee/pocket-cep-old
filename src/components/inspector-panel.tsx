/**
 * @file MCP Inspector panel showing raw JSON-RPC protocol traffic.
 */

"use client";

import { useState, useMemo } from "react";
import type { AgentEvent } from "@/lib/agent-loop";

type InspectorPanelProps = {
  events: AgentEvent[];
  isOpen: boolean;
  onToggle: () => void;
};

export function InspectorPanel({ events, isOpen, onToggle }: InspectorPanelProps) {
  const protocolEvents = useMemo(
    () => events.filter((e) => e.type === "mcp_request" || e.type === "mcp_response"),
    [events],
  );

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="fixed top-14 right-3 z-10 rounded-[var(--radius-sm)] bg-zinc-900 px-2.5 py-1.5 text-[11px] text-zinc-300 shadow-[var(--shadow-elevation-2)] hover:bg-zinc-800"
      >
        MCP Inspector ({protocolEvents.length})
      </button>
    );
  }

  return (
    <aside className="border-on-surface/10 flex w-72 shrink-0 flex-col border-l bg-zinc-900 lg:w-80">
      <div className="flex items-center justify-between border-b border-zinc-700/50 px-3 py-2">
        <div>
          <h2 className="text-xs font-medium text-zinc-100">MCP Inspector</h2>
          <p className="text-[10px] text-zinc-500">Raw JSON-RPC protocol traffic</p>
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-label="Close inspector"
          className="relative rounded-[var(--radius-xs)] p-1 text-zinc-400 hover:text-zinc-200"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" className="size-3.5">
            <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
          </svg>
          <span
            className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-x-1/2 -translate-y-1/2 pointer-fine:hidden"
            aria-hidden="true"
          />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {protocolEvents.length === 0 ? (
          <p className="text-center text-[11px] text-zinc-500">
            Protocol events will appear here as the agent calls MCP tools.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {protocolEvents.map((event, i) => (
              <ProtocolEventCard key={i} event={event} index={i} />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function ProtocolEventCard({ event, index }: { event: AgentEvent; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const isRequest = event.type === "mcp_request";
  const payload = "payload" in event ? event.payload : {};

  const params =
    isRequest && typeof payload.params === "object" && payload.params !== null
      ? (payload.params as Record<string, unknown>)
      : null;
  const toolName = isRequest ? String(params?.name ?? "?") : "response";

  return (
    <div className="rounded-[var(--radius-xs)] border border-zinc-700/50 bg-zinc-800">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left"
      >
        <span
          className={`rounded-[2px] px-1 py-0.5 font-mono text-[9px] font-semibold ${
            isRequest ? "bg-primary/20 text-blue-300" : "bg-success/20 text-green-300"
          }`}
        >
          {isRequest ? "REQ" : "RES"}
        </span>
        <span className="flex-1 truncate font-mono text-[11px] text-zinc-300">
          {String(toolName)}
        </span>
        <span className="font-mono text-[9px] text-zinc-600 tabular-nums">#{index + 1}</span>
      </button>

      {expanded && (
        <div className="border-t border-zinc-700/50 p-2">
          <pre className="overflow-x-auto font-mono text-[10px] leading-4 text-zinc-400">
            {JSON.stringify(payload, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
