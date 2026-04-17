/**
 * @file Chat message bubble with optional tool call expansion.
 *
 * Each message renders as a single bubble. Assistant messages may also
 * contain one or more collapsible ToolCallCards showing the MCP tool
 * name, input JSON, and result JSON. This gives learners visibility
 * into exactly what the agent asked the MCP server and what came back.
 *
 * Styled after Google Gemini: assistant messages have a small bot avatar,
 * timestamps below each bubble, a copy-to-clipboard button on hover,
 * and a slide-up entrance animation.
 *
 * Extension point: to render Markdown in assistant messages, replace
 * the `<div className="leading-5 ...">` with a Markdown renderer
 * (e.g., react-markdown) and add prose styling.
 */

"use client";

import { useState, useCallback } from "react";
import { Bot, Copy, Check } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Display-oriented representation of a single tool call. Populated
 * incrementally by the ChatPanel as SSE events arrive: first with
 * name + input (from a `tool_call` event), then patched with result
 * (from a `tool_result` event).
 */
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
  timestamp?: Date;
};

/**
 * Formats a Date to HH:MM for the compact timestamp below each bubble.
 * Uses the browser locale so the user sees their preferred clock format.
 */
function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * A single chat bubble styled after Google Gemini. User messages are
 * right-aligned with the primary color; assistant messages are
 * left-aligned with a bot avatar and a hover-to-copy button.
 * Tool calls render above the text content.
 */
export function ChatMessage({
  role,
  content,
  toolCalls,
  isStreaming,
  timestamp,
}: ChatMessageProps) {
  const isUser = role === "user";
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    /* Reset the check icon after a brief confirmation period */
    setTimeout(() => setCopied(false), 2000);
  }, [content]);

  return (
    <div className={cn("slide-up group flex gap-2", isUser ? "justify-end" : "justify-start")}>
      {/* Bot avatar gives assistant messages a distinct identity like Gemini */}
      {!isUser && (
        <div className="bg-primary/10 mt-1 flex size-6 shrink-0 items-center justify-center rounded-full">
          <Bot className="text-primary size-4" />
        </div>
      )}

      <div className="flex max-w-[80%] flex-col">
        {/* The bubble itself with a relative wrapper so copy button can be positioned */}
        <div className="relative">
          <div
            className={cn(
              "rounded-[var(--radius-md)] px-3 py-2",
              isUser
                ? "bg-primary text-on-primary"
                : "bg-surface text-on-surface ring-on-surface/5 ring-1",
            )}
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

          {/* Copy button appears on hover for assistant messages only */}
          {!isUser && content && (
            <button
              type="button"
              onClick={handleCopy}
              aria-label={copied ? "Copied" : "Copy message"}
              className="text-on-surface-muted hover:text-on-surface absolute top-1 right-1 rounded-[var(--radius-xs)] p-1 opacity-0 transition-opacity group-hover:opacity-100"
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </button>
          )}
        </div>

        {/* Compact timestamp matches Gemini's subtle time display */}
        {timestamp && (
          <span
            className={cn(
              "text-on-surface-muted mt-0.5 text-[10px]",
              isUser ? "text-right" : "text-left",
            )}
          >
            {formatTime(timestamp)}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Collapsible card showing a single MCP tool invocation. Collapsed by
 * default to keep the chat readable; expands to show raw JSON input
 * and result for educational inspection.
 */
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
          className={cn(
            "text-on-surface-muted size-3 shrink-0 transition-transform",
            expanded && "rotate-180",
          )}
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
                className={cn(
                  "mt-0.5 overflow-x-auto rounded-[var(--radius-xs)] p-2 font-mono text-[11px] leading-4",
                  toolCall.isError ? "bg-error-light text-error" : "bg-zinc-900 text-zinc-300",
                )}
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
