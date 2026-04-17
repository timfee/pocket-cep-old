/**
 * @file Zod-validated environment variables for Pocket CEP.
 *
 * Uses discriminated unions to enforce that each auth mode and LLM
 * provider has its required credentials. Invalid combinations are
 * caught at startup with clear error messages.
 *
 * The two independent axes — AUTH_MODE and LLM_PROVIDER — form a 2x2 matrix
 * of valid configurations. Zod's discriminatedUnion on each axis means
 * you get targeted error messages ("ANTHROPIC_API_KEY is required when
 * LLM_PROVIDER is claude") instead of a generic "missing field" error.
 */

import { z } from "zod";

/**
 * Regex-validated Google OAuth client ID. The strict format check catches
 * common copy-paste mistakes (e.g. trailing whitespace, wrapped in quotes)
 * before they surface as cryptic OAuth errors at runtime.
 */
const googleClientId = z
  .string()
  .min(1, "GOOGLE_CLIENT_ID is required in user_oauth mode.")
  .regex(
    /^\d+-\w+\.apps\.googleusercontent\.com$/,
    "GOOGLE_CLIENT_ID must match {numbers}-{hash}.apps.googleusercontent.com",
  );

const googleClientSecret = z
  .string()
  .min(1, "GOOGLE_CLIENT_SECRET is required in user_oauth mode.");

/**
 * Fields shared by both auth modes. Extracted so the two discriminated
 * union branches don't duplicate these definitions.
 */
const baseFields = {
  BETTER_AUTH_SECRET: z
    .string()
    .min(1, "BETTER_AUTH_SECRET is required. Run: openssl rand -base64 32"),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),
  MCP_SERVER_URL: z.string().url().default("http://localhost:4000/mcp"),
  LLM_MODEL: z.string().default(""),
};

/**
 * In service_account mode, Google OAuth credentials are optional — the MCP
 * server authenticates with its own ADC (Application Default Credentials).
 */
const serviceAccountAuth = z.object({
  ...baseFields,
  AUTH_MODE: z.literal("service_account"),
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
});

/**
 * In user_oauth mode, the user signs in with Google and the app forwards
 * their access token to the MCP server as a Bearer header. Both client ID
 * and secret are required for the OAuth consent flow.
 */
const userOAuthAuth = z.object({
  ...baseFields,
  AUTH_MODE: z.literal("user_oauth"),
  GOOGLE_CLIENT_ID: googleClientId,
  GOOGLE_CLIENT_SECRET: googleClientSecret,
});

const authSchema = z.discriminatedUnion("AUTH_MODE", [serviceAccountAuth, userOAuthAuth]);

const claudeProvider = z.object({
  LLM_PROVIDER: z.literal("claude"),
  ANTHROPIC_API_KEY: z
    .string()
    .min(
      1,
      'ANTHROPIC_API_KEY is required when LLM_PROVIDER is "claude". Get one at https://console.anthropic.com/',
    ),
  GOOGLE_AI_API_KEY: z.string().default(""),
});

const geminiProvider = z.object({
  LLM_PROVIDER: z.literal("gemini"),
  ANTHROPIC_API_KEY: z.string().default(""),
  GOOGLE_AI_API_KEY: z
    .string()
    .min(
      1,
      'GOOGLE_AI_API_KEY is required when LLM_PROVIDER is "gemini". Get one at https://aistudio.google.com/apikey',
    ),
});

const llmSchema = z.discriminatedUnion("LLM_PROVIDER", [claudeProvider, geminiProvider]);

/**
 * Zod's discriminatedUnion requires the discriminant field to exist in the
 * input. Since .env files omit optional keys, we use preprocess to inject
 * defaults before the union attempts to match on the discriminant.
 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * Combined server schema: auth axis AND llm axis. The `.and()` intersection
 * merges both discriminated unions into a single flat type, so `getEnv()`
 * returns one object with all fields from both axes.
 */
export const serverSchema = z.preprocess((raw) => {
  if (!isRecord(raw)) return raw;
  return {
    ...raw,
    AUTH_MODE: raw.AUTH_MODE || "service_account",
    LLM_PROVIDER: raw.LLM_PROVIDER || "claude",
  };
}, authSchema.and(llmSchema));

export type ServerEnv = z.infer<typeof serverSchema>;

/** Module-level cache — env is validated once per process, not per request. */
let _env: ServerEnv | null = null;

/**
 * Returns the validated server environment, parsing on first call.
 * Throws a developer-friendly error listing every invalid field at once
 * (rather than failing on the first one), so you can fix all issues in
 * a single pass.
 */
export function getEnv(): ServerEnv {
  if (_env) return _env;

  const result = serverSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");

    throw new Error(
      `\n\n[env] Environment validation failed:\n${formatted}\n\n` +
        "Check your .env and .env.local files. See .env.local.example for setup instructions.\n",
    );
  }

  _env = result.data;
  return _env;
}

/**
 * Lazy proxy that defers environment parsing until a property is actually
 * accessed. This allows importing `env` at module scope without triggering
 * validation during Next.js compilation (where process.env isn't fully
 * populated yet).
 */
export const env = new Proxy({} as ServerEnv, {
  get(_target, prop: string) {
    return getEnv()[prop as keyof ServerEnv];
  },
});
