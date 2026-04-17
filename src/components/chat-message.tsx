/**
 * @file Chat message bubble with optional tool call expansion.
 */

"use client";

import { useState } from "react";

export type ToolCallDisplay = {
  name: string;
  input: Record<string, unknown>;
  result?: unknown;
  isError?: boolean;
};

type ChatMessageProps = {
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCallDisplay[];
  isStreaming?: boolean;
};

export function ChatMessage({ role, content, toolCalls, isStreaming }: ChatMessageProps) {
  const isUser = role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-[var(--radius-md)] px-3 py-2 ${
          isUser
            ? "bg-primary text-on-primary"
            : "bg-surface text-on-surface ring-on-surface/5 ring-1"
        }`}
      >
        {toolCalls && toolCalls.length > 0 && (
          <div className="mb-1.5 flex flex-col gap-1">
            {toolCalls.map((tc, i) => (
              <ToolCallCard key={`${tc.name}-${i}`} toolCall={tc} />
            ))}
          </div>
        )}

        <div className="leading-5 text-pretty whitespace-pre-wrap">
          {content}
          {isStreaming && (
            <span className="bg-on-surface-muted ml-1 inline-block size-1.5 animate-pulse rounded-full" />
          )}
        </div>
      </div>
    </div>
  );
}

function ToolCallCard({ toolCall }: { toolCall: ToolCallDisplay }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-surface-dim ring-on-surface/10 rounded-[var(--radius-sm)] ring-1">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1 text-left"
      >
        <svg viewBox="0 0 16 16" fill="currentColor" className="fill-primary size-3 shrink-0">
          <path d="M6.955 2.606a.75.75 0 0 1 .45.69v9.408a.75.75 0 0 1-1.2.6L3.38 11.13H2a1 1 0 0 1-1-1V5.87a1 1 0 0 1 1-1h1.38l2.825-2.175a.75.75 0 0 1 .75-.09ZM8.5 5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 8.5 5Z" />
        </svg>
        <span className="text-on-surface-variant flex-1 truncate font-mono text-[11px]">
          {toolCall.name}
        </span>
        <svg
          viewBox="0 0 16 16"
          fill="currentColor"
          className={`text-on-surface-muted size-3 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
        >
          <path
            fillRule="evenodd"
            d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {expanded && (
        <div className="border-on-surface/5 border-t px-2.5 py-1.5">
          <div className="text-on-surface-muted text-[10px] font-medium tracking-wide uppercase">
            Input
          </div>
          <pre className="mt-0.5 overflow-x-auto rounded-[var(--radius-xs)] bg-zinc-900 p-2 font-mono text-[11px] leading-4 text-zinc-300">
            {JSON.stringify(toolCall.input, null, 2)}
          </pre>

          {toolCall.result !== undefined && (
            <>
              <div className="text-on-surface-muted mt-1.5 text-[10px] font-medium tracking-wide uppercase">
                Result{toolCall.isError ? " (error)" : ""}
              </div>
              <pre
                className={`mt-0.5 overflow-x-auto rounded-[var(--radius-xs)] p-2 font-mono text-[11px] leading-4 ${toolCall.isError ? "bg-error-light text-error" : "bg-zinc-900 text-zinc-300"}`}
              >
                {typeof toolCall.result === "string"
                  ? toolCall.result
                  : JSON.stringify(toolCall.result, null, 2)}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}
