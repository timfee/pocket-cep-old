/**
 * @file Zod-validated environment variables for Pocket CEP.
 *
 * Uses discriminated unions to enforce that each auth mode and LLM
 * provider has its required credentials. Invalid combinations are
 * caught at startup with clear error messages.
 */

import { z } from "zod";

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

const baseFields = {
  BETTER_AUTH_SECRET: z
    .string()
    .min(1, "BETTER_AUTH_SECRET is required. Run: openssl rand -base64 32"),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),
  MCP_SERVER_URL: z.string().url().default("http://localhost:4000/mcp"),
  LLM_MODEL: z.string().default(""),
};

const serviceAccountAuth = z.object({
  ...baseFields,
  AUTH_MODE: z.literal("service_account"),
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
});

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
 * Full server schema. Applies defaults for AUTH_MODE and LLM_PROVIDER before
 * parsing so the discriminated unions can match on the discriminant field.
 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export const serverSchema = z.preprocess((raw) => {
  if (!isRecord(raw)) return raw;
  return {
    ...raw,
    AUTH_MODE: raw.AUTH_MODE || "service_account",
    LLM_PROVIDER: raw.LLM_PROVIDER || "claude",
  };
}, authSchema.and(llmSchema));

export type ServerEnv = z.infer<typeof serverSchema>;

let _env: ServerEnv | null = null;

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

export const env = new Proxy({} as ServerEnv, {
  get(_target, prop: string) {
    return getEnv()[prop as keyof ServerEnv];
  },
});
