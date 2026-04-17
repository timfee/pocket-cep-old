/**
 * @file Chat input with an auto-growing textarea.
 *
 * Enter sends; Shift+Enter inserts a newline. While the agent is
 * streaming, the send button becomes a stop button.
 */

"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { ArrowUp, CornerDownLeft, Square } from "lucide-react";

type ChatInputProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  isStreaming: boolean;
  onStop: () => void;
  selectedUser: string;
};

const MIN_ROWS = 1;
const MAX_HEIGHT_PX = 200;

export function ChatInput({
  value,
  onChange,
  onSubmit,
  isStreaming,
  onStop,
  selectedUser,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [value]);

  useEffect(() => {
    if (!isStreaming) textareaRef.current?.focus();
  }, [isStreaming]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!isStreaming && value.trim()) {
        onSubmit(e);
      }
    }
  };

  const placeholder = selectedUser
    ? `Ask about ${selectedUser}…`
    : "Ask anything about Chrome Enterprise…";

  return (
    <div className="bg-surface-dim border-on-surface/10 shrink-0 border-t px-4 pt-3 pb-4">
      <form
        onSubmit={onSubmit}
        className="surface-raised relative mx-auto flex max-w-3xl items-end gap-2 rounded-[var(--radius-md)] px-3.5 py-2.5 focus-within:border-[var(--color-primary)] focus-within:shadow-[0_0_0_3px_rgb(26_115_232_/_0.15),var(--shadow-elevation-1)]"
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={MIN_ROWS}
          placeholder={placeholder}
          aria-label="Chat message input"
          className="text-on-surface placeholder:text-on-surface-muted max-h-[200px] flex-1 resize-none bg-transparent py-1 text-[0.9375rem] leading-6 focus:outline-none"
        />

        <div className="text-on-surface-muted flex shrink-0 items-center gap-2 pb-1 max-sm:hidden">
          <span className="flex items-center gap-1 text-[0.6875rem]">
            <kbd className="bg-surface-dim ring-on-surface/10 rounded-[3px] px-1 py-0.5 font-mono text-[0.625rem] ring-1">
              <CornerDownLeft className="inline size-2.5" />
            </kbd>
            send
          </span>
        </div>

        {isStreaming ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop generating"
            className="bg-on-surface text-surface hover:bg-ink focus-visible:outline-primary flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] shadow-[var(--shadow-elevation-1)] focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <Square className="size-3 fill-current" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!value.trim()}
            aria-label="Send message"
            className="bg-primary text-on-primary hover:bg-primary-hover focus-visible:outline-primary flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] shadow-[var(--shadow-elevation-1)] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-30 disabled:shadow-none"
          >
            <ArrowUp className="size-4" />
          </button>
        )}
      </form>
    </div>
  );
}
