/**
 * @file Gemini-styled chat input bar with send button.
 *
 * Controlled input that calls `onSend` with trimmed text on Enter or
 * button click. The input auto-focuses when `disabled` toggles off
 * (i.e., after the assistant finishes streaming), so the user can
 * immediately type a follow-up question without clicking.
 *
 * During streaming the send button swaps to a spinning loader icon,
 * giving clear visual feedback that a response is in progress.
 *
 * The send button uses a hidden touch-target expander (the invisible
 * `<span>` overlay) to meet the 48px minimum tap target on mobile
 * without inflating the visible button size.
 */

"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Loader2 } from "lucide-react";

type ChatInputProps = {
  onSend: (message: string) => void;
  disabled?: boolean;
  isStreaming?: boolean;
};

/**
 * Chat input with a send button. Disables itself during streaming to
 * prevent overlapping requests, and re-focuses after the stream ends.
 * Shows a spinning loader when streaming for Gemini-style feedback.
 */
export function ChatInput({ onSend, disabled, isStreaming }: ChatInputProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [disabled]);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="bg-surface border-on-surface/10 flex items-center gap-2 border-t px-3 py-2">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={disabled ? "Waiting for response..." : "Ask about this user..."}
        aria-label="Chat message input"
        name="chatMessage"
        className="bg-surface-container text-on-surface placeholder:text-on-surface-muted focus:ring-primary ring-on-surface/5 flex-1 rounded-[var(--radius-xl)] px-4 py-2 ring-1 focus:ring-2 focus:outline-none disabled:opacity-50"
      />
      <button
        type="button"
        onClick={handleSubmit}
        disabled={disabled || !value.trim()}
        aria-label={isStreaming ? "Waiting for response" : "Send message"}
        className="bg-primary text-on-primary hover:bg-primary-hover focus-visible:outline-primary relative flex size-9 shrink-0 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40"
      >
        {/* Swap between send arrow and spinner so users know the agent is working */}
        {isStreaming ? <Loader2 className="spin-slow size-4" /> : <Send className="size-4" />}
        <span
          className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-x-1/2 -translate-y-1/2 pointer-fine:hidden"
          aria-hidden="true"
        />
      </button>
    </div>
  );
}
