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
};

type ChatPanelProps = {
  selectedUser: string;
  onProtocolEvent: (event: AgentEvent) => void;
};

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
 * "type" field). This avoids an unsafe `as AgentEvent` cast on untrusted data.
 */
function isAgentEvent(value: unknown): value is AgentEvent {
  return typeof value === "object" && value !== null && "type" in value;
}

/**
 * The main chat interface. Manages the message list, sends user messages
 * to the /api/chat SSE endpoint, and streams assistant responses in real time.
 */
export function ChatPanel({ selectedUser, onProtocolEvent }: ChatPanelProps) {
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

      // Build history from the ref (everything before this new message).
      // The server appends `message` itself, so history doesn't include it.
      const history = messagesRef.current.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      setMessages((prev) => [...prev, { role: "user", content: message }]);
      setIsStreaming(true);

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, selectedUser, history }),
        });

        if (!response.ok || !response.body) {
          const errorText = await response.text();
          setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${errorText}` }]);
          setIsStreaming(false);
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        let assistantText = "";
        let toolCalls: ToolCallDisplay[] = [];
        let buffer = "";

        setMessages((prev) => [...prev, { role: "assistant", content: "", toolCalls: [] }]);

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
              // Immutable update: map to a new array with the matching entry replaced.
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
          { role: "assistant", content: `Error: ${getErrorMessage(error, "Connection failed")}` },
        ]);
      } finally {
        setIsStreaming(false);
      }
    },
    [selectedUser, onProtocolEvent],
  );

  return (
    <div className="flex flex-1 flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <p className="text-on-surface-variant">
                {selectedUser
                  ? `Ask a question about ${selectedUser}`
                  : "Select a user to investigate"}
              </p>
              <p className="text-on-surface-muted mt-1 text-xs">
                Check activity logs, licenses, DLP rules, and more.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((msg, i) => (
              <ChatMessage
                key={i}
                role={msg.role}
                content={msg.content}
                toolCalls={msg.toolCalls}
                isStreaming={isStreaming && i === messages.length - 1 && msg.role === "assistant"}
              />
            ))}
          </div>
        )}
      </div>

      <ChatInput onSend={handleSend} disabled={isStreaming || !selectedUser} />
    </div>
  );
}
