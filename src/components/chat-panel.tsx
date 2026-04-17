/**
 * @file Main chat panel using the Vercel AI SDK v6 useChat hook.
 *
 * Scroll behavior: auto-follow the bottom while streaming ONLY when the
 * user is already near the bottom. If they scroll up, we stop chasing
 * and surface a "Jump to latest" pill to resume.
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

const SUGGESTED_WITH_USER: SuggestedPrompt[] = [
  {
    title: "Recent Chrome activity",
    body: "Show the last 10 days of audit events for this user.",
    icon: FileSearch,
  },
  {
    title: "CEP license status",
    body: "Does this user have an active Chrome Enterprise Premium seat?",
    icon: Scale,
  },
  {
    title: "Environment health",
    body: "Run the diagnostic: APIs, connectors, policies.",
    icon: Stethoscope,
  },
];

const SUGGESTED_WITHOUT_USER: SuggestedPrompt[] = [
  {
    title: "Environment health",
    body: "Run the diagnostic: APIs, connectors, policies.",
    icon: Stethoscope,
  },
  {
    title: "Active DLP rules",
    body: "List the Data Loss Prevention rules currently in effect.",
    icon: FileSearch,
  },
  {
    title: "CEP subscription",
    body: "Check the org's Chrome Enterprise Premium subscription.",
    icon: Scale,
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
    if (!text.trim()) return;
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

  const prompts = selectedUser ? SUGGESTED_WITH_USER : SUGGESTED_WITHOUT_USER;

  return (
    <div className="bg-surface-dim flex min-h-0 flex-1 flex-col">
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div ref={scrollRef} data-testid="chat-scroll" className="flex-1 overflow-y-auto px-6 py-8">
          {isEmpty ? (
            <EmptyState selectedUser={selectedUser} prompts={prompts} onPick={handleSend} />
          ) : (
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
              {messages.map((msg) => (
                <ChatMessage key={msg.id} message={msg} />
              ))}
              {showTyping && <TypingIndicator />}
            </div>
          )}

          {error && (
            <div className="bg-error-light text-error ring-error/20 mx-auto mt-4 max-w-3xl rounded-[var(--radius-sm)] px-3 py-2 text-sm ring-1">
              {error.message}
            </div>
          )}

          <div ref={bottomRef} aria-hidden="true" />
        </div>

        {!isPinnedToBottom && !isEmpty && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="bg-surface text-on-surface-variant ring-on-surface/15 hover:bg-surface-container fade-in absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium shadow-[var(--shadow-elevation-2)] ring-1"
          >
            <ArrowDown className="size-3.5" />
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
        selectedUser={selectedUser}
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

function EmptyState({
  selectedUser,
  prompts,
  onPick,
}: {
  selectedUser: string;
  prompts: SuggestedPrompt[];
  onPick: (prompt: string) => void;
}) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 pt-6">
      <div className="fade-in flex flex-col gap-1.5">
        <h2 className="text-on-surface text-2xl leading-8 font-medium tracking-tight">
          {selectedUser ? (
            <>
              Investigate{" "}
              <span className="text-primary font-mono text-xl tracking-tight">{selectedUser}</span>
            </>
          ) : (
            "What would you like to check?"
          )}
        </h2>
        <p className="text-on-surface-variant text-sm leading-5">
          {selectedUser
            ? "Ask anything — the agent can pull audit events, license state, DLP policy, and diagnostics for this user."
            : "Ask anything about your Chrome Enterprise Premium environment. Pick a user from the left to scope questions to them."}
        </p>
      </div>

      <div className="flex flex-col gap-2.5">
        <h3 className="text-on-surface-variant text-xs font-medium">Suggested</h3>
        <ul role="list" className="grid gap-2 sm:grid-cols-2">
          {prompts.map((prompt, i) => (
            <li key={prompt.title} className={i === 2 ? "sm:col-span-2" : undefined}>
              <button
                type="button"
                onClick={() => onPick(prompt.body)}
                className={`surface-raised group slide-up stagger-${i + 1} flex h-full w-full flex-col gap-2 rounded-[var(--radius-sm)] p-3.5 text-left`}
              >
                <div className="flex items-center gap-2.5">
                  <span className="bg-primary-light text-primary grid size-7 shrink-0 place-items-center rounded-[var(--radius-xs)]">
                    <prompt.icon className="size-3.5" />
                  </span>
                  <span className="text-on-surface flex-1 text-sm font-medium">{prompt.title}</span>
                  <ArrowUpRight className="text-on-surface-muted size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </div>
                <p className="text-on-surface-variant pl-[calc(--spacing(7)+--spacing(2.5))] text-[0.8125rem] leading-5">
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
