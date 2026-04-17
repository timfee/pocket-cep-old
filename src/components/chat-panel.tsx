/**
 * @file Main chat panel using the Vercel AI SDK v6 useChat hook.
 *
 * The inspector panel feed is deduplicated: we only forward a tool part
 * to the parent when its `(toolCallId, state)` pair changes. Without this
 * guard, every streaming token update would re-forward every tool part in
 * the conversation — the inspector would fill with dozens of duplicates.
 */

"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatMessage } from "./chat-message";
import { ChatInput } from "./chat-input";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, User } from "lucide-react";
import type { InvocationPart } from "@/lib/tool-part";

type ChatPanelProps = {
  selectedUser: string;
  onToolInvocation?: (invocation: InvocationPart) => void;
};

const SUGGESTED_PROMPTS = [
  "Show recent Chrome activity",
  "Check CEP license status",
  "Diagnose environment health",
];

export function ChatPanel({ selectedUser, onToolInvocation }: ChatPanelProps) {
  const [input, setInput] = useState("");

  const selectedUserRef = useRef(selectedUser);
  useEffect(() => {
    selectedUserRef.current = selectedUser;
  }, [selectedUser]);

  /**
   * `body` is a function so the AI SDK resolves it at send-time and
   * reads the current selectedUser — if we passed the value directly,
   * the transport would bake in the initial empty string on first render.
   */
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
    <div className="flex flex-1 flex-col">
      {selectedUser && (
        <div className="bg-surface-dim border-on-surface/5 flex items-center gap-2 border-b px-3 py-1.5">
          <User className="text-on-surface-muted size-3.5" />
          <span className="text-on-surface-variant text-xs">
            Investigating: <span className="text-on-surface font-medium">{selectedUser}</span>
          </span>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3">
        {isEmpty && selectedUser ? (
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <Sparkles className="text-primary/30 size-8" />
            <p className="text-on-surface-variant text-sm">
              Start investigating <span className="font-medium">{selectedUser}</span>
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTED_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => handleSend(prompt)}
                  className="state-layer bg-surface ring-on-surface/10 rounded-[var(--radius-xl)] px-3 py-1.5 text-xs ring-1"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : isEmpty ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-on-surface-muted text-xs">Select a user to investigate</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
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
          <div className="bg-error-light text-error ring-error/20 mt-3 rounded-[var(--radius-sm)] px-3 py-2 text-xs ring-1">
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
