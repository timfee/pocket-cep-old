/**
 * @file Catalog of LLM models exposed in the top-bar model selector.
 *
 * The list is intentionally short and opinionated: five mainstream
 * models across Anthropic, OpenAI, and Google. Each carries the
 * metadata the UI needs to:
 *
 * - render a pretty name,
 * - decide whether it can be used out of the box (server has the env
 *   key) or requires BYOK (client-provided key in localStorage),
 * - route the chat request to the correct Vercel AI SDK provider.
 *
 * **Security**: the `envKey` field is a *name* (e.g. "OPENAI_API_KEY")
 * — never a value. Whether that env var is populated is reported as a
 * boolean via `ModeInfo.availableProviders`; the actual secret never
 * leaves the server.
 */

/**
 * Providers we wire to Vercel AI SDK packages.
 */
export type ModelProvider = "anthropic" | "openai" | "google";

/**
 * Server env var names corresponding to each provider. The name is
 * public (shown to users so they know which key to provide); the value
 * is server-only.
 */
export type ModelEnvKey = "ANTHROPIC_API_KEY" | "OPENAI_API_KEY" | "GOOGLE_AI_API_KEY";

/**
 * A single entry in the model picker.
 */
export type ModelOption = {
  /** Canonical model ID sent to the provider SDK. */
  id: string;
  /** User-facing name. */
  label: string;
  /** Vercel AI SDK provider namespace. */
  provider: ModelProvider;
  /** Name of the env var the server checks for server-side credentials. */
  envKey: ModelEnvKey;
  /** Short descriptor shown below the label in the picker. */
  description: string;
};

/**
 * The mainstream five. Order here is the default ranking before
 * "available first" re-sorting.
 */
export const MODEL_OPTIONS: readonly ModelOption[] = [
  {
    id: "claude-opus-4-7",
    label: "Claude Opus 4.7",
    provider: "anthropic",
    envKey: "ANTHROPIC_API_KEY",
    description: "Anthropic's most capable model.",
  },
  {
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    provider: "anthropic",
    envKey: "ANTHROPIC_API_KEY",
    description: "Balanced speed and intelligence from Anthropic.",
  },
  {
    id: "gpt-5",
    label: "GPT-5",
    provider: "openai",
    envKey: "OPENAI_API_KEY",
    description: "OpenAI's flagship reasoning model.",
  },
  {
    id: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    provider: "google",
    envKey: "GOOGLE_AI_API_KEY",
    description: "Google's flagship multimodal model.",
  },
  {
    id: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    provider: "google",
    envKey: "GOOGLE_AI_API_KEY",
    description: "Fast and efficient Gemini variant.",
  },
];

/**
 * Returns the option matching the given ID, or `undefined` for unknown
 * IDs (e.g. a stale localStorage value after we delete a model).
 */
export function getModelById(id: string): ModelOption | undefined {
  return MODEL_OPTIONS.find((m) => m.id === id);
}

/**
 * localStorage key holding the currently-selected model ID.
 */
export const MODEL_SELECTION_KEY = "cep_selected_model";

/**
 * localStorage key prefix for user-supplied API keys. Each provider
 * stores at `<prefix><provider>` (e.g. `cep_byok_openai`). Keys live
 * entirely in the browser; they're sent to the server only as the
 * `X-Pocket-Cep-Key` header on the specific request that needs them
 * and never persisted server-side.
 */
export const BYOK_STORAGE_PREFIX = "cep_byok_";

/**
 * HTTP header the chat route reads for a user-supplied API key
 * (format: `<provider>:<key>`). Intentionally not an Authorization-
 * like header — we don't want browsers to confuse it with the
 * session cookie or BetterAuth's bearer scheme.
 */
export const BYOK_HEADER = "x-pocket-cep-byok";
