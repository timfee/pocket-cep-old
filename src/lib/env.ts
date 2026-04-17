/**
 * @file Zod-validated environment variables for Pocket CEP.
 *
 * Every env var the app uses is declared here with a Zod schema. Importing
 * this module validates the environment at startup — if anything is missing
 * or malformed, the app crashes immediately with a clear error message
 * instead of failing later at runtime in a confusing way.
 *
 * Extension point: to add a new env var, add it to the appropriate schema
 * (serverSchema or clientSchema), then access it via `env.YOUR_VAR`.
 */

import { z } from "zod";

/**
 * The two auth modes that control how Pocket CEP authenticates with the
 * MCP server. See .env for detailed descriptions of each mode.
 */
const authModeSchema = z.enum(["service_account", "user_oauth"]);

/**
 * The supported LLM providers for the chat agent.
 */
const llmProviderSchema = z.enum(["claude", "gemini"]);

/**
 * Schema for server-side environment variables. These are only available
 * in API routes and Server Components — never shipped to the browser.
 *
 * We use .default() for optional vars and .refine() for conditional
 * requirements (e.g. ANTHROPIC_API_KEY is only required when LLM_PROVIDER
 * is "claude").
 */
export const serverSchema = z
  .object({
    // Auth
    AUTH_MODE: authModeSchema.default("service_account"),
    BETTER_AUTH_SECRET: z
      .string()
      .min(1, "BETTER_AUTH_SECRET is required. Run: openssl rand -base64 32"),
    BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),

    // Google OAuth
    GOOGLE_CLIENT_ID: z.string().min(1, "GOOGLE_CLIENT_ID is required. See .env.local.example."),
    GOOGLE_CLIENT_SECRET: z
      .string()
      .min(1, "GOOGLE_CLIENT_SECRET is required. See .env.local.example."),

    // MCP Server
    MCP_SERVER_URL: z.string().url().default("http://localhost:4000/mcp"),
    MCP_SERVER_CMD: z.string().optional().default(""),

    // LLM
    LLM_PROVIDER: llmProviderSchema.default("claude"),
    LLM_MODEL: z.string().optional().default(""),
    ANTHROPIC_API_KEY: z.string().optional().default(""),
    GOOGLE_AI_API_KEY: z.string().optional().default(""),
  })
  .superRefine((data, ctx) => {
    // Ensure the correct API key is set for the chosen LLM provider.
    if (data.LLM_PROVIDER === "claude" && !data.ANTHROPIC_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ANTHROPIC_API_KEY"],
        message:
          'ANTHROPIC_API_KEY is required when LLM_PROVIDER is "claude". ' +
          "Get one at https://console.anthropic.com/",
      });
    }

    if (data.LLM_PROVIDER === "gemini" && !data.GOOGLE_AI_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["GOOGLE_AI_API_KEY"],
        message:
          'GOOGLE_AI_API_KEY is required when LLM_PROVIDER is "gemini". ' +
          "Get one at https://aistudio.google.com/apikey",
      });
    }
  });

/**
 * Validated and typed server environment. Crashes at import time if
 * validation fails, so you get immediate feedback during `next dev`.
 */
export type ServerEnv = z.infer<typeof serverSchema>;

/**
 * Parse and validate process.env. We call this lazily (on first access)
 * so that build-time type generation doesn't fail when env vars aren't set.
 */
let _env: ServerEnv | null = null;

/**
 * Returns the validated server environment, parsing on first call.
 * Throws a descriptive error if any variable is missing or invalid.
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
 * Convenience re-export: the validated environment object.
 *
 * Usage in any server-side file:
 *   import { env } from "@/lib/env";
 *   console.log(env.MCP_SERVER_URL);
 *
 * This triggers validation on first access. If you see an error during
 * `next dev`, it means an env var is missing — check the error message.
 */
export const env = new Proxy({} as ServerEnv, {
  get(_target, prop: string) {
    return getEnv()[prop as keyof ServerEnv];
  },
});
