/**
 * @file Chat message bubble rendering AI SDK v6 UIMessage parts.
 */

"use client";

import { useEffect, useState } from "react";
import { Bot, ChevronDown, ChevronRight, Copy, Check, Zap } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/cn";
import { isToolUIPart, getToolName } from "ai";
import type { UIMessage } from "ai";
import { toolPartLabel, type InvocationPart } from "@/lib/tool-part";
import { reportAuthErrorGlobally } from "@/lib/auth-aware-fetch";
import { isAuthErrorPayload, type AuthErrorPayload } from "@/lib/auth-errors";

type ChatMessageProps = {
  message: UIMessage;
};

/**
 * Metadata attached by the chat panel when a user message was produced
 * from clicking an MCP prompt card. We render those messages as a
 * compact chip instead of showing the expanded prompt body, which can
 * run hundreds of lines of formatting rules.
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

  const errorText = "errorText" in part ? part.errorText : undefined;
  const authPayload = parseAuthPayload(errorText);
  const output = "output" in part ? part.output : undefined;
  const hasArgs = isNonEmptyObject(part.input);
  const hasOutput = output !== undefined && output !== null;

  if (authPayload) {
    return <AuthToolCard payload={authPayload} />;
  }

  return (
    <div className="bg-surface-dim ring-on-surface/10 my-1.5 overflow-hidden rounded-[var(--radius-sm)] ring-1">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="state-layer flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
      >
        {expanded ? (
          <ChevronDown className="text-on-surface-muted size-3 shrink-0" aria-hidden="true" />
        ) : (
          <ChevronRight className="text-on-surface-muted size-3 shrink-0" aria-hidden="true" />
        )}
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
        <div className="border-on-surface/5 flex flex-col gap-3 border-t px-3 py-2.5">
          {hasArgs && (
            <ToolSection title="Arguments">
              <ToolJson value={part.input} />
            </ToolSection>
          )}

          {hasOutput && (
            <ToolSection title="Result">
              <ToolOutput value={output} />
            </ToolSection>
          )}

          {errorText && (
            <ToolSection title="Error" tone="error">
              <p className="text-error/90 leading-4 whitespace-pre-wrap">{String(errorText)}</p>
            </ToolSection>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Common section wrapper for the expanded tool card. The inset
 * border-left keeps the whole block visually subordinate to the
 * assistant message it's nested inside.
 */
function ToolSection({
  title,
  tone = "default",
  children,
}: {
  title: string;
  tone?: "default" | "error";
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn("border-l-2 pl-3", tone === "error" ? "border-error/40" : "border-primary/30")}
    >
      <h4 className="text-on-surface-muted mb-1 text-[0.625rem] font-semibold tracking-wide uppercase">
        {title}
      </h4>
      <div className="text-[0.75rem]">{children}</div>
    </section>
  );
}

/**
 * Renders an MCP tool result's `content` array (text blocks with
 * embedded markdown + JSON fences) as real markdown. Non-text blocks
 * fall through to a JSON view. Arbitrary non-array output shapes land
 * in the `ToolJson` fallback so we never silently drop data.
 */
function ToolOutput({ value }: { value: unknown }) {
  if (Array.isArray(value) && value.every(isTextBlock)) {
    return (
      <div className="prose-chat">
        {value.map((block, i) => (
          <ReactMarkdown key={i} remarkPlugins={[remarkGfm]}>
            {block.text}
          </ReactMarkdown>
        ))}
      </div>
    );
  }
  return <ToolJson value={value} />;
}

function ToolJson({ value }: { value: unknown }) {
  return (
    <pre className="bg-surface-container text-on-surface-variant overflow-x-auto rounded-[var(--radius-xs)] p-2 font-mono text-[10px] leading-4">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function isTextBlock(x: unknown): x is { type: "text"; text: string } {
  if (!x || typeof x !== "object") return false;
  const rec = x as Record<string, unknown>;
  return rec.type === "text" && typeof rec.text === "string";
}

function isNonEmptyObject(x: unknown): boolean {
  return !!x && typeof x === "object" && !Array.isArray(x) && Object.keys(x).length > 0;
}

/**
 * Detects an AuthErrorPayload inside a tool part's errorText. The AI SDK
 * serializes thrown errors' messages, so AuthError's JSON-stringified
 * payload arrives as a plain string — we parse and run the canonical
 * guard so every surface accepts the same shape.
 */
function parseAuthPayload(errorText: unknown): AuthErrorPayload | null {
  if (typeof errorText !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(errorText);
    return isAuthErrorPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Distinguished auth-error card. Amber (call to action) instead of red
 * (failure), so the user's eye goes straight to the remedy.
 */
function AuthToolCard({ payload }: { payload: AuthErrorPayload }) {
  useEffect(() => {
    reportAuthErrorGlobally(payload);
  }, [payload]);

  return (
    <div className="bg-warning-light text-warning ring-warning/30 my-1.5 rounded-[var(--radius-sm)] px-3 py-2 text-xs ring-1">
      <p className="font-semibold">Authentication required</p>
      <p className="text-warning/80 mt-0.5 leading-4">{payload.remedy}</p>
      {payload.command && (
        <code className="bg-surface-container text-on-surface-variant mt-1.5 inline-block rounded-[var(--radius-xs)] px-1.5 py-0.5 font-mono text-[11px]">
          {payload.command}
        </code>
      )}
      {payload.docsUrl && (
        <a
          href={payload.docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary ml-2 text-[11px] underline"
        >
          Details
        </a>
      )}
    </div>
  );
}
