/**
 * @file Top-bar model selector.
 *
 * Surfaces {@link MODEL_OPTIONS} in a compact dropdown. Models whose
 * provider API key is populated server-side (per `ModeInfo.availableProviders`)
 * or client-side via BYOK are ranked first and marked "Ready"; the
 * rest collapse into an inline "Add API key" affordance that writes
 * the key to `localStorage` only. Keys are **never** sent anywhere
 * except as a per-request `X-Pocket-Cep-Byok` header on the chat call
 * — they're never logged and never persisted server-side.
 *
 * Selection is persisted under `MODEL_SELECTION_KEY`. The chat transport
 * reads both the selection and any BYOK key from localStorage on each
 * message send; this component only owns the UI and the writes.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, KeyRound, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { useMode } from "./mode-provider";
import {
  BYOK_STORAGE_PREFIX,
  MODEL_OPTIONS,
  MODEL_SELECTION_KEY,
  getModelById,
  type ModelOption,
  type ModelProvider,
} from "@/lib/models";

const PROVIDER_LABELS: Record<ModelProvider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
};

const PROVIDER_KEY_URLS: Record<ModelProvider, string> = {
  anthropic: "https://console.anthropic.com/",
  openai: "https://platform.openai.com/api-keys",
  google: "https://aistudio.google.com/apikey",
};

/**
 * Reads the stored BYOK key for a provider. Returns empty string when
 * nothing is stored or storage is unavailable.
 */
function readByokKey(provider: ModelProvider): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(BYOK_STORAGE_PREFIX + provider) ?? "";
  } catch {
    return "";
  }
}

/**
 * Persists a BYOK key (or clears it with empty string).
 */
function writeByokKey(provider: ModelProvider, value: string): void {
  if (typeof window === "undefined") return;
  try {
    if (value) {
      window.localStorage.setItem(BYOK_STORAGE_PREFIX + provider, value);
    } else {
      window.localStorage.removeItem(BYOK_STORAGE_PREFIX + provider);
    }
  } catch {
    // Storage disabled — BYOK simply won't persist this session.
  }
}

/**
 * Returns the currently-selected model ID from localStorage, or the
 * server default passed in. SSR-safe (returns the fallback when there
 * is no `window`).
 */
function readSelectedModel(fallback: string): string {
  if (typeof window === "undefined") return fallback;
  try {
    return window.localStorage.getItem(MODEL_SELECTION_KEY) || fallback;
  } catch {
    return fallback;
  }
}

type ModelAvailability = {
  /** Server has the env key populated. */
  env: boolean;
  /** User has pasted a key into BYOK for this provider. */
  byok: boolean;
};

/**
 * Top-bar dropdown that lets the user pick the active chat model and
 * paste BYOK keys for providers the server can't fulfil.
 */
export function ModelSelector() {
  const mode = useMode();
  const [isOpen, setIsOpen] = useState(false);
  const [selected, setSelected] = useState<string>(() => readSelectedModel(mode.llmModel));
  const [byokKeys, setByokKeys] = useState<Record<ModelProvider, string>>(() => ({
    anthropic: "",
    openai: "",
    google: "",
  }));
  const containerRef = useRef<HTMLDivElement>(null);

  /**
   * Hydrate BYOK keys + the persisted selection after mount so SSR and
   * client first render agree. The server default in `useState(() =>
   * readSelectedModel(mode.llmModel))` is deliberately naive to avoid
   * hydration mismatches; we reconcile here.
   */
  useEffect(() => {
    setByokKeys({
      anthropic: readByokKey("anthropic"),
      openai: readByokKey("openai"),
      google: readByokKey("google"),
    });
    const stored = readSelectedModel(mode.llmModel);
    if (stored !== selected) {
      setSelected(stored);
    }
    // Run only on mount; subsequent changes come from user actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close on outside click.
  useEffect(() => {
    if (!isOpen) return;
    function handler(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setIsOpen(false);
    }
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [isOpen]);

  function availabilityFor(opt: ModelOption): ModelAvailability {
    return {
      env: mode.availableProviders[opt.provider],
      byok: Boolean(byokKeys[opt.provider]),
    };
  }

  /**
   * Ranked view: ready-to-use models first (env or BYOK), then the rest.
   * Original order is preserved within each bucket.
   */
  const ranked = [...MODEL_OPTIONS].sort((a, b) => {
    const aReady = mode.availableProviders[a.provider] || Boolean(byokKeys[a.provider]);
    const bReady = mode.availableProviders[b.provider] || Boolean(byokKeys[b.provider]);
    if (aReady === bReady) return 0;
    return aReady ? -1 : 1;
  });

  function selectModel(opt: ModelOption) {
    const { env, byok } = availabilityFor(opt);
    if (!env && !byok) return; // row's "Add API key" panel stays open
    setSelected(opt.id);
    try {
      window.localStorage.setItem(MODEL_SELECTION_KEY, opt.id);
    } catch {
      // preference simply won't persist
    }
    setIsOpen(false);
  }

  function updateByok(provider: ModelProvider, value: string) {
    writeByokKey(provider, value);
    setByokKeys((prev) => ({ ...prev, [provider]: value }));
  }

  const selectedOption = getModelById(selected) ?? getModelById(mode.llmModel) ?? MODEL_OPTIONS[0];

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className="state-layer bg-surface-dim text-on-surface-variant ring-on-surface/10 inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[0.6875rem] font-medium ring-1"
      >
        <Sparkles className="text-primary size-3" aria-hidden="true" />
        <span className="max-w-[14ch] truncate">{selectedOption.label}</span>
        <ChevronDown className="text-on-surface-muted size-3" aria-hidden="true" />
      </button>

      {isOpen && (
        <div
          role="listbox"
          aria-label="Choose a model"
          className="bg-surface ring-on-surface/10 absolute top-full right-0 z-30 mt-1.5 w-80 overflow-hidden rounded-[var(--radius-sm)] shadow-[var(--shadow-elevation-2)] ring-1"
        >
          <header className="border-on-surface/10 flex items-baseline justify-between border-b px-3 py-2">
            <h3 className="text-on-surface text-xs font-semibold">Model</h3>
            <span className="text-on-surface-muted text-[0.625rem]">via Vercel AI SDK</span>
          </header>

          <ul role="list" className="max-h-96 overflow-y-auto p-1">
            {ranked.map((opt) => {
              const avail = availabilityFor(opt);
              const isSelected = opt.id === selected;
              return (
                <li key={opt.id}>
                  <ModelRow
                    option={opt}
                    availability={avail}
                    isSelected={isSelected}
                    byokValue={byokKeys[opt.provider]}
                    onSelect={() => selectModel(opt)}
                    onByokChange={(value) => updateByok(opt.provider, value)}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

type ModelRowProps = {
  option: ModelOption;
  availability: ModelAvailability;
  isSelected: boolean;
  byokValue: string;
  onSelect: () => void;
  onByokChange: (value: string) => void;
};

/**
 * One row in the dropdown. When the model is ready to use, the whole
 * row is a select button. When it needs BYOK, the row expands into a
 * labeled password-style input.
 */
function ModelRow({
  option,
  availability,
  isSelected,
  byokValue,
  onSelect,
  onByokChange,
}: ModelRowProps) {
  const isReady = availability.env || availability.byok;
  const [showKey, setShowKey] = useState(false);

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-[var(--radius-xs)] p-2",
        isSelected ? "bg-primary-light" : "hover:bg-surface-dim",
      )}
    >
      <button
        type="button"
        onClick={isReady ? onSelect : () => setShowKey((v) => !v)}
        role="option"
        aria-selected={isSelected}
        disabled={!isReady && showKey}
        className="flex items-start gap-2 text-left disabled:cursor-default"
      >
        <span
          className={cn(
            "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full",
            isSelected ? "bg-primary text-on-primary" : "bg-surface-dim text-on-surface-muted",
          )}
          aria-hidden="true"
        >
          {isSelected && <Check className="size-2.5" />}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "truncate text-xs font-medium",
                isSelected ? "text-primary" : "text-on-surface",
              )}
            >
              {option.label}
            </span>
            <span
              className={cn(
                "shrink-0 rounded-full px-1.5 py-0.5 text-[0.625rem] tabular-nums",
                availability.env
                  ? "bg-success/15 text-green-700"
                  : availability.byok
                    ? "bg-primary/15 text-primary"
                    : "bg-surface-container text-on-surface-muted",
              )}
            >
              {availability.env ? "Ready" : availability.byok ? "Your key" : "Needs key"}
            </span>
          </div>
          <p className="text-on-surface-muted mt-0.5 text-[0.6875rem] leading-4">
            {PROVIDER_LABELS[option.provider]} · {option.description}
          </p>
        </div>
      </button>

      {!isReady && showKey && (
        <ByokInput
          option={option}
          value={byokValue}
          onChange={onByokChange}
          onCancel={() => setShowKey(false)}
        />
      )}

      {isReady && availability.byok && !availability.env && (
        <button
          type="button"
          onClick={() => setShowKey((v) => !v)}
          className="text-on-surface-muted hover:text-on-surface self-start text-[0.6875rem] underline"
        >
          {showKey ? "Hide key" : "Edit key"}
        </button>
      )}

      {showKey && availability.byok && !availability.env && (
        <ByokInput
          option={option}
          value={byokValue}
          onChange={onByokChange}
          onCancel={() => setShowKey(false)}
        />
      )}
    </div>
  );
}

type ByokInputProps = {
  option: ModelOption;
  value: string;
  onChange: (value: string) => void;
  onCancel: () => void;
};

/**
 * Password-style input for a user-provided API key. The key lives in
 * `localStorage` only — it's sent to the chat route as a single
 * per-request header, never logged, never persisted server-side.
 */
function ByokInput({ option, value, onChange, onCancel }: ByokInputProps) {
  const [draft, setDraft] = useState(value);

  function save() {
    onChange(draft.trim());
    onCancel();
  }

  return (
    <div className="bg-surface-dim ring-on-surface/10 flex flex-col gap-2 rounded-[var(--radius-xs)] p-2 ring-1">
      <label className="text-on-surface-variant flex items-center gap-1.5 text-[0.6875rem] font-medium">
        <KeyRound className="size-3" aria-hidden="true" />
        <span>{option.envKey} (stays in your browser)</span>
      </label>
      <input
        type="password"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        autoComplete="off"
        spellCheck={false}
        placeholder={`Paste your ${PROVIDER_LABELS[option.provider]} key`}
        className="bg-surface text-on-surface ring-on-surface/10 focus:ring-primary rounded-[var(--radius-xs)] px-2 py-1 font-mono text-[11px] ring-1 focus:ring-2 focus:outline-none"
      />
      <div className="flex items-center justify-between gap-2">
        <a
          href={PROVIDER_KEY_URLS[option.provider]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-on-surface-muted hover:text-primary text-[0.625rem] underline"
        >
          Get a key ↗
        </a>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onCancel}
            className="text-on-surface-muted hover:text-on-surface rounded-[var(--radius-xs)] px-2 py-0.5 text-[0.6875rem]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            className="bg-primary text-on-primary rounded-[var(--radius-xs)] px-2 py-0.5 text-[0.6875rem] font-medium"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
