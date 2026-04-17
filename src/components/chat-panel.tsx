/**
 * @file Main chat panel using the Vercel AI SDK v6 useChat hook.
 *
 * The inspector panel feed is deduplicated: we only forward a tool part
 * to the parent when its `(toolCallId, state)` pair changes. Without
 * this guard, every streaming token update would re-forward every part.
 *
 * Scroll behavior: we auto-follow the bottom while streaming ONLY when
 * the user is already near the bottom. If they scroll up to re-read
 * earlier output, we stop chasing them and surface a "Jump to latest"
 * pill they can click to resume.
 */

"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatMessage } from "./chat-message";
import { ChatInput } from "./chat-input";
import { ArrowDown, ArrowUpRight, FileSearch, Scale, Stethoscope } from "lucide-react";
import type { InvocationPart } from "@/lib/tool-part";

type ChatPanelProps = {
  selectedUser: string;
  onToolInvocation?: (invocation: InvocationPart) => void;
};

type SuggestedPrompt = {
  title: string;
  body: string;
  icon: React.ComponentType<{ className?: string }>;
};

const SUGGESTED_PROMPTS: SuggestedPrompt[] = [
  {
    title: "Recent Chrome activity",
    body: "Pull the last 10 days of audit events for this user.",
    icon: FileSearch,
  },
  {
    title: "CEP license status",
    body: "Check whether this user has an active Chrome Enterprise Premium seat.",
    icon: Scale,
  },
  {
    title: "Environment health",
    body: "Run the diagnostic: APIs enabled, connectors live, policies applied.",
    icon: Stethoscope,
  },
];

export function ChatPanel({ selectedUser, onToolInvocation }: ChatPanelProps) {
  const [input, setInput] = useState("");

  const selectedUserRef = useRef(selectedUser);
  useEffect(() => {
    selectedUserRef.current = selectedUser;
  }, [selectedUser]);

  const resolveBody = useCallback(() => ({ selectedUser: selectedUserRef.current }), []);
  const transport = useMemo(
    // eslint-disable-next-line react-hooks/refs -- body is resolveBody, not a ref read
    () => new DefaultChatTransport({ api: "/api/chat", body: resolveBody }),
    [resolveBody],
  );

  const { messages, sendMessage, status, stop, error } = useChat({ transport });

  const isStreaming = status === "streaming" || status === "submitted";
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);

  useEffect(() => {
    if (!isPinnedToBottom) return;
    const raf = requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    });
    return () => cancelAnimationFrame(raf);
  }, [messages, isPinnedToBottom]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setIsPinnedToBottom(distanceFromBottom < 120);
    };
    el.addEventListener("scroll", handler, { passive: true });
    return () => el.removeEventListener("scroll", handler);
  }, []);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    setIsPinnedToBottom(true);
  }, []);

  const lastFiredStateRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (!onToolInvocation) return;
    for (const msg of messages) {
      if (msg.role !== "assistant" || !msg.parts) continue;
      for (const part of msg.parts) {
        if (!isToolUIPart(part)) continue;
        const id = part.toolCallId;
        if (!id) continue;
        if (lastFiredStateRef.current.get(id) === part.state) continue;
        lastFiredStateRef.current.set(id, part.state);
        onToolInvocation(part);
      }
    }
  }, [messages, onToolInvocation]);

  const handleSend = (text: string) => {
    if (!text.trim() || !selectedUser) return;
    sendMessage({ text });
    setInput("");
    setIsPinnedToBottom(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSend(input);
  };

  const isEmpty = messages.length === 0;
  const lastMsg = messages[messages.length - 1];
  const showTyping =
    isStreaming &&
    (!lastMsg ||
      lastMsg.role !== "assistant" ||
      lastMsg.parts.every((p) => p.type !== "text" || !p.text));

  return (
    <div className="bg-surface-dim flex flex-1 flex-col">
      {selectedUser && (
        <div className="bg-surface border-on-surface/10 flex h-9 items-center gap-2 border-b px-5">
          <span className="text-on-surface-muted text-[0.6875rem]">Viewing</span>
          <span className="font-mono text-[0.75rem] tracking-tight">{selectedUser}</span>
          <span className="ml-auto flex items-center gap-1.5">
            <span
              className={`size-1.5 rounded-full ${isStreaming ? "bg-primary pulse-dot" : "bg-success"}`}
              aria-hidden="true"
            />
            <span className="text-on-surface-variant text-[0.6875rem]">
              {isStreaming ? "Thinking" : "Ready"}
            </span>
          </span>
        </div>
      )}

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
          {isEmpty && selectedUser ? (
            <BriefingEmptyState
              selectedUser={selectedUser}
              onPick={(prompt) => handleSend(prompt)}
            />
          ) : isEmpty ? (
            <DeskEmptyState />
          ) : (
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
              {messages.map((msg) => (
                <ChatMessage key={msg.id} message={msg} />
              ))}
              {showTyping && <TypingIndicator />}
            </div>
          )}

          {error && (
            <div className="bg-error-light text-error ring-error/20 mx-auto mt-4 max-w-3xl rounded-[var(--radius-sm)] px-3 py-2 text-xs ring-1">
              {error.message}
            </div>
          )}

          <div ref={bottomRef} aria-hidden="true" />
        </div>

        {!isPinnedToBottom && !isEmpty && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="bg-surface text-on-surface-variant ring-on-surface/15 hover:bg-surface-container fade-in absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full px-3 py-1.5 text-[0.6875rem] font-medium shadow-[var(--shadow-elevation-2)] ring-1"
          >
            <ArrowDown className="size-3" />
            <span>Jump to latest</span>
          </button>
        )}
      </div>

      <ChatInput
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        isStreaming={isStreaming}
        onStop={stop}
        disabled={!selectedUser}
      />
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="fade-in flex items-center gap-2 pl-10">
      <div className="bg-surface ring-on-surface/10 flex items-center gap-1 rounded-[var(--radius-md)] px-3 py-2.5 ring-1">
        <span className="typing-dot typing-dot-1 bg-on-surface-muted size-1.5 rounded-full" />
        <span className="typing-dot typing-dot-2 bg-on-surface-muted size-1.5 rounded-full" />
        <span className="typing-dot typing-dot-3 bg-on-surface-muted size-1.5 rounded-full" />
      </div>
    </div>
  );
}

function DeskEmptyState() {
  return (
    <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-3 text-center">
      <h1 className="slide-up text-on-surface text-[1.5rem] leading-8 font-medium tracking-tight text-balance">
        Pick a user to start an investigation.
      </h1>
      <p className="text-on-surface-variant slide-up stagger-1 text-[0.8125rem] leading-5 text-balance">
        Search the directory on the left — users with recent Chrome audit activity are surfaced at
        the top.
      </p>
      <div className="text-on-surface-muted slide-up stagger-2 flex items-center gap-2 text-xs">
        <kbd className="bg-surface ring-on-surface/10 rounded-[var(--radius-xs)] px-1.5 py-0.5 font-mono text-[0.625rem] ring-1">
          /
        </kbd>
        <span>to focus search</span>
      </div>
    </div>
  );
}

function BriefingEmptyState({
  selectedUser,
  onPick,
}: {
  selectedUser: string;
  onPick: (prompt: string) => void;
}) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="fade-in flex flex-col gap-1">
        <h2 className="text-on-surface text-[1.25rem] leading-7 font-medium tracking-tight">
          Ask about{" "}
          <span className="text-primary font-mono text-[1.0625rem] tracking-tight">
            {selectedUser}
          </span>
        </h2>
        <p className="text-on-surface-variant text-[0.8125rem] leading-5">
          The agent has Chrome Enterprise Premium tools wired up via MCP — audit logs, license
          state, DLP policy, and environment diagnostics.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="section-label">Suggested</h3>
        <ul role="list" className="grid gap-2 sm:grid-cols-2">
          {SUGGESTED_PROMPTS.map((prompt, i) => (
            <li key={prompt.title} className={i === 2 ? "sm:col-span-2" : undefined}>
              <button
                type="button"
                onClick={() => onPick(prompt.body)}
                className={`surface-raised group slide-up stagger-${i + 1} relative flex h-full w-full flex-col gap-2 rounded-[var(--radius-sm)] p-3 text-left`}
              >
                <div className="flex items-center gap-2">
                  <span className="bg-primary-light text-primary grid size-7 place-items-center rounded-[var(--radius-xs)]">
                    <prompt.icon className="size-3.5" />
                  </span>
                  <span className="text-on-surface text-[0.8125rem] font-semibold">
                    {prompt.title}
                  </span>
                  <ArrowUpRight className="text-on-surface-muted ml-auto size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </div>
                <p className="text-on-surface-variant pl-9 text-[0.75rem] leading-4">
                  {prompt.body}
                </p>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
