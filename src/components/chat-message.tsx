/**
 * @file Chat message bubble rendering AI SDK v6 UIMessage parts.
 */

"use client";

import { useState } from "react";
import { Bot, Copy, Check, Zap } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/cn";
import { isToolUIPart, getToolName } from "ai";
import type { UIMessage } from "ai";
import { toolPartLabel, type InvocationPart } from "@/lib/tool-part";

type ChatMessageProps = {
  message: UIMessage;
};

/**
 * Messages produced by clicking an MCP prompt card carry a tiny
 * metadata object. The UI collapses them to a compact chip so the full
 * prompt body (which can be hundreds of lines of formatting rules)
 * doesn't dominate the chat.
 */
type PromptMetadata = { promptName?: string; promptTitle?: string };

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";
  const promptMeta = isUser ? (message.metadata as PromptMetadata | undefined) : undefined;

  if (promptMeta?.promptName) {
    return (
      <div className="slide-up flex justify-end">
        <div className="bg-primary-light text-primary ring-primary/20 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1">
          <Zap className="size-3" />
          <span>Ran</span>
          <span className="font-mono text-[0.75rem]">{promptMeta.promptName}</span>
        </div>
      </div>
    );
  }

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
                <div key={`text-${i}`} className="leading-5 text-pretty whitespace-pre-wrap">
                  {part.text}
                </div>
              );
            }
            return (
              <div key={`text-${i}`} className="prose-chat">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
              </div>
            );
          }

          if (isToolUIPart(part)) {
            return <ToolPartCard key={part.toolCallId ?? `tool-${i}`} part={part} />;
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
        ? "bg-success-light text-green-700"
        : "bg-primary-light text-primary";

  return (
    <div className="bg-surface-dim ring-on-surface/10 my-1.5 rounded-[var(--radius-sm)] ring-1">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
      >
        <span className="text-on-surface flex-1 truncate font-mono text-xs">
          {getToolName(part)}
        </span>
        <span
          className={cn(
            "inline-flex items-center rounded-[var(--radius-xs)] px-1.5 py-0.5 text-[0.625rem] font-semibold tracking-wide uppercase",
            badgeClass,
          )}
        >
          {label}
        </span>
      </button>

      {expanded && (
        <div className="border-on-surface/5 border-t px-2.5 py-2">
          <pre className="bg-surface-container text-on-surface-variant overflow-x-auto rounded-[var(--radius-xs)] p-2.5 font-mono text-[0.6875rem] leading-4">
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
