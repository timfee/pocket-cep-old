/**
 * @file Main chat panel that orchestrates messages, input, and SSE streaming.
 *
 * This is the primary interactive component. It manages conversation state,
 * connects to the /api/chat SSE endpoint, and renders the message list
 * with streaming support. The chat panel consumes SSE events from the
 * agent loop and dispatches them to the message list and inspector panel.
 *
 * SSE event flow:
 *   1. User types a message -> ChatInput calls handleSend
 *   2. handleSend POSTs to /api/chat with message + history
 *   3. The server streams back AgentEvent objects as SSE lines
 *   4. This component reads the stream via ReadableStream.getReader()
 *   5. Each event type updates local state differently:
 *      - "text"        -> appends to assistant message content
 *      - "tool_call"   -> adds a new ToolCallDisplay entry
 *      - "tool_result" -> patches the matching ToolCallDisplay with result
 *      - "mcp_request" / "mcp_response" -> forwarded to InspectorPanel via prop
 *      - "error"       -> appends error text to the message
 *      - "done"        -> implicit (stream ends)
 *
 * The SSE parsing uses a manual buffer + split approach rather than
 * EventSource because EventSource does not support POST requests or
 * custom headers (needed for auth cookies).
 */

"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { User, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ChatMessage, type ToolCallDisplay } from "./chat-message";
import { ChatInput } from "./chat-input";
import { getErrorMessage } from "@/lib/errors";
import type { AgentEvent } from "@/lib/agent-loop";

/**
 * A message in the local conversation state. Extends the server-side
 * ChatMessage with optional toolCalls for display purposes. Tool calls
 * are tracked here (not sent back to the server) so the UI can show
 * expandable cards inside assistant bubbles.
 */
type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCallDisplay[];
  timestamp?: Date;
};

type ChatPanelProps = {
  selectedUser: string;
  onProtocolEvent: (event: AgentEvent) => void;
  eventCount?: number;
};

/** Suggested prompts shown in the empty state to reduce blank-page anxiety. */
const PROMPT_CHIPS = [
  "Show recent Chrome activity",
  "Check CEP license status",
  "Diagnose environment health",
] as const;

/**
 * Updates the last assistant message in the conversation with new fields.
 * Used by every SSE event handler to avoid duplicating the updater logic.
 */
function updateLastAssistant(
  prev: ConversationMessage[],
  patch: Partial<ConversationMessage>,
): ConversationMessage[] {
  const updated = [...prev];
  const last = updated[updated.length - 1];
  if (last?.role !== "assistant") return prev;
  updated[updated.length - 1] = { ...last, ...patch };
  return updated;
}

/**
 * Validates that a parsed JSON value looks like an AgentEvent (has a string
 * "type" field). This avoids an unsafe cast on untrusted data.
 */
function isAgentEvent(value: unknown): value is AgentEvent {
  return typeof value === "object" && value !== null && "type" in value;
}

/**
 * The main chat interface. Manages the message list, sends user messages
 * to the /api/chat SSE endpoint, and streams assistant responses in real time.
 * Styled after Google Gemini with a context bar, empty-state prompt chips,
 * and skeleton loading during streaming.
 */
export function ChatPanel({ selectedUser, onProtocolEvent, eventCount }: ChatPanelProps) {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  /**
   * Refs mirror the latest state values so handleSend can read them
   * without being in useCallback's dependency array. Without this,
   * every streamed text chunk would recreate the callback (since
   * `messages` changes), causing the ChatInput to re-render and lose
   * focus mid-stream.
   */
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const isStreamingRef = useRef(isStreaming);
  useEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const handleSend = useCallback(
    async (message: string) => {
      if (!selectedUser || isStreamingRef.current) return;

      const history = messagesRef.current.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      setMessages((prev) => [...prev, { role: "user", content: message, timestamp: new Date() }]);
      setIsStreaming(true);

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, selectedUser, history }),
        });

        if (!response.ok || !response.body) {
          const errorText = await response.text();
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: `Error: ${errorText}`, timestamp: new Date() },
          ]);
          setIsStreaming(false);
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        let assistantText = "";
        let toolCalls: ToolCallDisplay[] = [];
        let buffer = "";

        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "", toolCalls: [], timestamp: new Date() },
        ]);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;

            let event: AgentEvent;
            try {
              const parsed: unknown = JSON.parse(line.slice(6));
              if (!isAgentEvent(parsed)) continue;
              event = parsed;
            } catch {
              continue;
            }

            if (event.type === "mcp_request" || event.type === "mcp_response") {
              onProtocolEvent(event);
            }

            if (event.type === "text") {
              assistantText += event.text;
              setMessages((prev) =>
                updateLastAssistant(prev, { content: assistantText, toolCalls }),
              );
            }

            if (event.type === "tool_call") {
              toolCalls = [...toolCalls, { name: event.name, input: event.input }];
              setMessages((prev) => updateLastAssistant(prev, { toolCalls }));
            }

            if (event.type === "tool_result") {
              toolCalls = toolCalls.map((t) =>
                t.name === event.name && t.result === undefined
                  ? { ...t, result: event.result, isError: event.isError }
                  : t,
              );
              setMessages((prev) => updateLastAssistant(prev, { toolCalls }));
            }

            if (event.type === "error") {
              assistantText += `\n\nError: ${event.message}`;
              setMessages((prev) => updateLastAssistant(prev, { content: assistantText }));
            }
          }
        }
      } catch (error) {
        setMessages((prev) => [
          ...prev.slice(0, -1),
          {
            role: "assistant",
            content: `Error: ${getErrorMessage(error, "Connection failed")}`,
            timestamp: new Date(),
          },
        ]);
      } finally {
        setIsStreaming(false);
      }
    },
    [selectedUser, onProtocolEvent],
  );

  const lastMessage = messages[messages.length - 1];
  const showSkeleton = isStreaming && lastMessage?.role === "assistant" && !lastMessage.content;

  return (
    <div className="flex flex-1 flex-col">
      {/* Context bar: shows the current investigation target for orientation */}
      {selectedUser && (
        <div className="bg-surface border-on-surface/10 flex items-center gap-2 border-b px-3 py-1.5">
          <User className="text-on-surface-variant size-3.5" />
          <span className="text-on-surface-variant text-xs">
            Investigating: <span className="text-on-surface font-medium">{selectedUser}</span>
          </span>
          {eventCount !== undefined && eventCount > 0 && (
            <Badge variant="muted">{eventCount}</Badge>
          )}
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            {selectedUser ? (
              /* Gemini-style empty state with sparkle icon and prompt chips */
              <div className="fade-in flex max-w-sm flex-col items-center text-center">
                <Sparkles className="text-primary/30 size-8" />
                <h3 className="text-on-surface mt-3 text-sm font-medium">
                  Start investigating {selectedUser}
                </h3>
                <p className="text-on-surface-muted mt-1 text-xs">
                  Ask a question or pick a suggestion below.
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {PROMPT_CHIPS.map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => handleSend(chip)}
                      className="state-layer bg-surface-container text-on-surface-variant ring-on-surface/10 hover:bg-surface-container/80 rounded-[var(--radius-xl)] px-3 py-1.5 text-xs ring-1 transition-colors"
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center">
                <p className="text-on-surface-variant">Select a user to investigate</p>
                <p className="text-on-surface-muted mt-1 text-xs">
                  Check activity logs, licenses, DLP rules, and more.
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((msg, i) => (
              <div key={i} className="slide-up">
                <ChatMessage
                  role={msg.role}
                  content={msg.content}
                  toolCalls={msg.toolCalls}
                  timestamp={msg.timestamp}
                  isStreaming={isStreaming && i === messages.length - 1 && msg.role === "assistant"}
                />
              </div>
            ))}

            {/* Staggered skeleton lines while waiting for the first token */}
            {showSkeleton && (
              <div className="slide-up flex flex-col gap-2 pl-8">
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            )}
          </div>
        )}
      </div>

      <ChatInput
        onSend={handleSend}
        disabled={isStreaming || !selectedUser}
        isStreaming={isStreaming}
      />
    </div>
  );
}
