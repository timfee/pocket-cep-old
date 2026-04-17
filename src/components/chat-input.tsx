/**
 * @file Chat input bar integrated with AI SDK's useChat.
 */

"use client";

import { useRef, useEffect } from "react";
import { ArrowUp, CornerDownLeft, Loader2 } from "lucide-react";

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
    <div className="bg-surface-dim border-on-surface/10 shrink-0 border-t px-4 pt-3 pb-4">
      <form
        onSubmit={onSubmit}
        className="surface-raised relative mx-auto flex max-w-3xl items-center gap-2 rounded-[var(--radius-md)] px-3 py-2 focus-within:border-[var(--color-primary)] focus-within:shadow-[0_0_0_3px_rgb(26_115_232_/_0.15),var(--shadow-elevation-1)]"
      >
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={onChange}
          disabled={disabled || isLoading}
          placeholder={
            disabled
              ? "Select a user before asking a question…"
              : isLoading
                ? "Thinking…"
                : "Ask the agent to investigate…"
          }
          aria-label="Chat message input"
          name="prompt"
          className="text-on-surface placeholder:text-on-surface-muted flex-1 bg-transparent text-[13.5px] focus:outline-none disabled:opacity-60"
        />

        <div className="text-on-surface-muted flex items-center gap-1 text-[10px] max-sm:hidden">
          <CornerDownLeft className="size-3" />
          <span>enter</span>
        </div>

        <button
          type="submit"
          disabled={disabled || isLoading || !value.trim()}
          aria-label="Send message"
          className="bg-primary text-on-primary hover:bg-primary-hover focus-visible:outline-primary relative flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] shadow-[var(--shadow-elevation-1)] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-30 disabled:shadow-none"
        >
          {isLoading ? <Loader2 className="spin-slow size-3.5" /> : <ArrowUp className="size-4" />}
        </button>
      </form>
    </div>
  );
}
