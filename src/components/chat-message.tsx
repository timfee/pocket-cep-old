/**
 * @file Chat message bubble rendering AI SDK v6 UIMessage parts.
 */

"use client";

import { useState } from "react";
import { Bot, Copy, Check } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/cn";
import { isToolUIPart, getToolName } from "ai";
import type { UIMessage } from "ai";
import { toolPartLabel, type InvocationPart } from "@/lib/tool-part";

type ChatMessageProps = {
  message: UIMessage;
};

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";

  return (
    <div className={cn("slide-up flex gap-2", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <div className="bg-primary/10 flex size-6 shrink-0 items-center justify-center rounded-full">
          <Bot className="text-primary size-3.5" />
        </div>
      )}

      <div
        className={cn(
          "group max-w-[80%] rounded-[var(--radius-md)] px-3 py-2",
          isUser
            ? "bg-primary text-on-primary"
            : "bg-surface text-on-surface ring-on-surface/5 ring-1",
        )}
      >
        {message.parts.map((part, i) => {
          if (part.type === "text" && part.text) {
            if (isUser) {
              return (
                <div key={i} className="leading-5 text-pretty whitespace-pre-wrap">
                  {part.text}
                </div>
              );
            }
            return (
              <div key={i} className="prose-chat">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
              </div>
            );
          }

          if (isToolUIPart(part)) {
            return <ToolPartCard key={i} part={part} />;
          }

          return null;
        })}

        {!isUser && <CopyButton parts={message.parts} />}
      </div>
    </div>
  );
}

function CopyButton({ parts }: { parts: UIMessage["parts"] }) {
  const [copied, setCopied] = useState(false);
  const text = parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join("\n");

  if (!text) return null;

  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="text-on-surface-muted hover:text-on-surface mt-1 opacity-0 transition-opacity group-hover:opacity-100"
      aria-label="Copy message"
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
    </button>
  );
}

function ToolPartCard({ part }: { part: InvocationPart }) {
  const [expanded, setExpanded] = useState(false);

  const label = toolPartLabel(part.state);
  const badgeClass =
    label === "ERROR"
      ? "bg-error/20 text-error"
      : label === "DONE"
        ? "bg-success/20 text-green-700"
        : "bg-primary/20 text-primary";

  return (
    <div className="bg-surface-dim ring-on-surface/10 my-1 rounded-[var(--radius-sm)] ring-1">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1 text-left"
      >
        <span className="text-on-surface-variant flex-1 truncate font-mono text-[11px]">
          {getToolName(part)}
        </span>
        <span
          className={cn("rounded-[2px] px-1 py-0.5 font-mono text-[9px] font-semibold", badgeClass)}
        >
          {label}
        </span>
      </button>

      {expanded && (
        <div className="border-on-surface/5 border-t px-2.5 py-1.5">
          <pre className="bg-surface-container text-on-surface-variant overflow-x-auto rounded-[var(--radius-xs)] p-2 font-mono text-[11px] leading-4">
            {JSON.stringify(
              {
                input: part.input,
                output: "output" in part ? part.output : undefined,
                errorText: "errorText" in part ? part.errorText : undefined,
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
