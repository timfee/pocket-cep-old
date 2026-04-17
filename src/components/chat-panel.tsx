/**
 * @file Main chat panel using the Vercel AI SDK v6 useChat hook.
 *
 * Carries two layered responsibilities:
 * - Hosting the streaming conversation (messages, scroll, tool parts).
 * - Presenting thoughtful empty states when there's nothing to show —
 *   a "no user selected" desk, and a "user selected / no messages"
 *   briefing that frames the investigation before it starts.
 *
 * The inspector panel feed is deduplicated: we only forward a tool part
 * to the parent when its `(toolCallId, state)` pair changes. Without this
 * guard, every streaming token update would re-forward every tool part.
 */

"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatMessage } from "./chat-message";
import { ChatInput } from "./chat-input";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, ArrowUpRight, FileSearch, Scale, Stethoscope } from "lucide-react";
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

  const { messages, sendMessage, status, error } = useChat({ transport });

  const isLoading = status === "streaming" || status === "submitted";
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    });
    return () => cancelAnimationFrame(raf);
  }, [messages]);

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
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSend(input);
  };

  const isEmpty = messages.length === 0;
  const lastMsg = messages[messages.length - 1];
  const showSkeleton =
    isLoading && lastMsg?.role === "assistant" && lastMsg.parts.every((p) => p.type !== "text");

  return (
    <div className="bg-surface-dim flex flex-1 flex-col">
      {selectedUser && (
        <div className="bg-surface border-on-surface/10 flex h-9 items-center gap-2 border-b px-4">
          <span className="eyebrow leading-none">Case file</span>
          <span className="bg-on-surface/10 h-3 w-px" aria-hidden="true" />
          <span className="font-mono text-[11px] tracking-tight">{selectedUser}</span>
          <span className="ml-auto flex items-center gap-1.5">
            <span className="bg-success size-1.5 rounded-full" aria-hidden="true" />
            <span className="eyebrow leading-none">Live</span>
          </span>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
        {isEmpty && selectedUser ? (
          <BriefingEmptyState selectedUser={selectedUser} onPick={(prompt) => handleSend(prompt)} />
        ) : isEmpty ? (
          <DeskEmptyState />
        ) : (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
            {messages.map((msg) => (
              <ChatMessage key={msg.id} message={msg} />
            ))}
            {showSkeleton && (
              <div className="flex flex-col gap-1.5 pl-8">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-1/3" />
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="bg-error-light text-error ring-error/20 mx-auto mt-4 max-w-3xl rounded-[var(--radius-sm)] px-3 py-2 text-xs ring-1">
            {error.message}
          </div>
        )}

        <div ref={bottomRef} aria-hidden="true" />
      </div>

      <ChatInput
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onSubmit={handleSubmit}
        isLoading={isLoading}
        disabled={!selectedUser}
      />
    </div>
  );
}

function DeskEmptyState() {
  return (
    <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center gap-4 text-center">
      <span className="eyebrow slide-up">No subject selected</span>
      <h1 className="text-on-surface slide-up stagger-1 max-w-md text-[1.625rem] leading-[1.15] font-medium tracking-tight text-balance">
        Pick a user to start an investigation.
      </h1>
      <p className="text-on-surface-variant slide-up stagger-2 max-w-md text-[13px] leading-5">
        Search the directory on the left — users with recent Chrome audit activity are surfaced at
        the top.
      </p>
      <div className="text-on-surface-muted slide-up stagger-3 flex items-center gap-2 text-xs">
        <kbd className="bg-surface ring-on-surface/10 rounded-[var(--radius-xs)] px-1.5 py-0.5 font-mono text-[10px] ring-1">
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
      <div className="fade-in flex flex-col gap-1.5">
        <span className="eyebrow">Subject</span>
        <h2 className="text-on-surface text-[1.375rem] leading-tight font-medium tracking-tight">
          Investigate{" "}
          <span className="text-primary font-mono text-[1.1rem] tracking-tight">
            {selectedUser}
          </span>
        </h2>
        <p className="text-on-surface-variant mt-1 text-[13px] leading-5">
          Ask anything. The agent has Chrome Enterprise Premium tools wired up via MCP — audit logs,
          license state, DLP policy, environment diagnostics.
        </p>
      </div>

      <div className="slide-up stagger-1 flex flex-col gap-2">
        <span className="eyebrow">Suggested</span>
        <div className="grid gap-2 sm:grid-cols-2">
          {SUGGESTED_PROMPTS.map((prompt, i) => (
            <button
              key={prompt.title}
              type="button"
              onClick={() => onPick(prompt.body)}
              className={`group surface-raised slide-up relative flex flex-col gap-2 rounded-[var(--radius-sm)] p-3 text-left transition-shadow hover:shadow-[var(--shadow-elevation-2)] stagger-${i + 1} ${i === 2 ? "sm:col-span-2" : ""}`}
            >
              <div className="flex items-center gap-2">
                <span className="bg-primary-light text-primary grid size-7 place-items-center rounded-[var(--radius-xs)]">
                  <prompt.icon className="size-3.5" />
                </span>
                <span className="text-on-surface text-[13px] font-semibold">{prompt.title}</span>
                <ArrowUpRight className="text-on-surface-muted ml-auto size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </div>
              <p className="text-on-surface-variant pl-9 text-[12px] leading-4">{prompt.body}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="slide-up stagger-4 text-on-surface-muted flex items-center gap-1.5 text-[11px]">
        <Activity className="size-3" />
        <span>Tool calls stream into the inspector drawer as the agent works.</span>
      </div>
    </div>
  );
}
