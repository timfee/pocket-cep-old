/**
 * @file Chat input bar integrated with AI SDK's useChat.
 */

"use client";

import { useRef, useEffect } from "react";
import { Send, Loader2 } from "lucide-react";

type ChatInputProps = {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSubmit: (e: React.FormEvent) => void;
  isLoading: boolean;
  disabled?: boolean;
};

export function ChatInput({ value, onChange, onSubmit, isLoading, disabled }: ChatInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isLoading) inputRef.current?.focus();
  }, [isLoading]);

  return (
    <form
      onSubmit={onSubmit}
      className="bg-surface border-on-surface/10 flex items-center gap-2 border-t px-3 py-2"
    >
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={onChange}
        disabled={disabled || isLoading}
        placeholder={isLoading ? "Waiting for response..." : "Ask about this user..."}
        aria-label="Chat message input"
        name="prompt"
        className="bg-surface-container text-on-surface placeholder:text-on-surface-muted focus:ring-primary ring-on-surface/5 flex-1 rounded-[var(--radius-xl)] px-4 py-2 ring-1 focus:ring-2 focus:outline-none disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={disabled || isLoading || !value.trim()}
        aria-label="Send message"
        className="bg-primary text-on-primary hover:bg-primary-hover focus-visible:outline-primary relative flex size-9 shrink-0 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40"
      >
        {isLoading ? <Loader2 className="spin-slow size-4" /> : <Send className="size-4" />}
        <span
          className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-x-1/2 -translate-y-1/2 pointer-fine:hidden"
          aria-hidden="true"
        />
      </button>
    </form>
  );
}
