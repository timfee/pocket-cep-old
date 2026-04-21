/**
 * @file Streaming chat API route using the Vercel AI SDK.
 *
 * POST /api/chat
 * Body: { messages: UIMessage[], selectedUser: string, modelId?: string }
 * Headers: x-pocket-cep-byok: "<provider>:<api-key>"  (optional BYOK)
 * Response: UI message stream (consumed by useChat on the frontend)
 *
 * The client picks a model from the top-bar selector; this route
 * looks up the chosen `modelId`, instantiates the matching Vercel AI
 * SDK provider (Anthropic / OpenAI / Google), and streams. If the
 * server env doesn't carry the provider's key, the client may
 * forward a user-supplied key via the BYOK header. That key is used
 * only to construct this single SDK call and is never logged or
 * persisted.
 */

import { streamText, convertToModelMessages, stepCountIs } from "ai";
import type { LanguageModel, UIMessage } from "ai";
import { anthropic, createAnthropic } from "@ai-sdk/anthropic";
import { google, createGoogleGenerativeAI } from "@ai-sdk/google";
import { openai, createOpenAI } from "@ai-sdk/openai";
import { getGoogleAccessToken } from "@/lib/access-token";
import { getEnv } from "@/lib/env";
import { getMcpToolsForAiSdk } from "@/lib/mcp-tools";
import { requireSession } from "@/lib/session";
import { buildSystemPrompt, LOG_TAGS, DEFAULT_MODELS, MAX_AGENT_ITERATIONS } from "@/lib/constants";
import { getErrorMessage } from "@/lib/errors";
import { isAuthError } from "@/lib/auth-errors";
import { BYOK_HEADER, getModelById, type ModelOption, type ModelProvider } from "@/lib/models";

export async function POST(request: Request) {
  if (!(await requireSession())) {
    return new Response(JSON.stringify({ error: "Not authenticated" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = await request.json();
  const {
    messages,
    selectedUser = "",
    modelId,
  }: { messages: UIMessage[]; selectedUser?: string; modelId?: string } = body;

  if (!messages) {
    return new Response(JSON.stringify({ error: "messages is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const config = getEnv();
  const accessToken = await getGoogleAccessToken();

  console.log(
    LOG_TAGS.CHAT,
    `Chat for ${selectedUser || "(no user)"}, ${messages.length} messages`,
  );

  let tools;
  try {
    tools = await getMcpToolsForAiSdk(config.MCP_SERVER_URL, accessToken);
  } catch (error) {
    if (isAuthError(error)) {
      return new Response(JSON.stringify({ error: error.toPayload() }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: getErrorMessage(error) }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  const modelOption = resolveModelOption(modelId, config.LLM_PROVIDER);
  const byok = parseByokHeader(request.headers.get(BYOK_HEADER), modelOption.provider);
  let model: LanguageModel;
  try {
    model = buildModel(modelOption, byok, config);
  } catch (error) {
    return new Response(JSON.stringify({ error: getErrorMessage(error) }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const result = streamText({
    model,
    system: buildSystemPrompt(selectedUser),
    messages: await convertToModelMessages(messages),
    tools,
    stopWhen: stepCountIs(MAX_AGENT_ITERATIONS),
  });

  return result.toUIMessageStreamResponse();
}

/**
 * Looks up a model option by its client-supplied ID. Falls back to the
 * server-configured default when the ID is missing or unrecognised (a
 * stale localStorage value from a previous build, say).
 */
function resolveModelOption(
  modelId: string | undefined,
  fallbackProvider: "claude" | "gemini",
): ModelOption {
  if (modelId) {
    const match = getModelById(modelId);
    if (match) return match;
  }
  const fallback = getModelById(DEFAULT_MODELS[fallbackProvider]);
  if (fallback) return fallback;
  // Shouldn't happen — DEFAULT_MODELS values are part of MODEL_OPTIONS.
  throw new Error(`No model found for fallback provider ${fallbackProvider}`);
}

/**
 * Parses the `x-pocket-cep-byok` header into a (provider, key) pair
 * and returns the key only when it matches the model's provider.
 * Any parse failure silently resolves to `undefined` — the chat route
 * falls through to the server env key next.
 */
function parseByokHeader(raw: string | null, expected: ModelProvider): string | undefined {
  if (!raw) return undefined;
  const separator = raw.indexOf(":");
  if (separator <= 0 || separator >= raw.length - 1) return undefined;
  const provider = raw.slice(0, separator);
  const key = raw.slice(separator + 1).trim();
  if (provider !== expected || !key) return undefined;
  return key;
}

/**
 * Instantiates the Vercel AI SDK model for the selected provider,
 * preferring a caller-supplied BYOK key, then the server env key.
 * Throws if neither is available so the client can surface a helpful
 * "missing key" message instead of the chat silently looping.
 */
function buildModel(
  option: ModelOption,
  byokKey: string | undefined,
  config: ReturnType<typeof getEnv>,
): LanguageModel {
  if (option.provider === "anthropic") {
    const apiKey = byokKey || config.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        `${option.label} requires ANTHROPIC_API_KEY. Set it in .env.local or paste a key via the model picker.`,
      );
    }
    return byokKey ? createAnthropic({ apiKey })(option.id) : anthropic(option.id);
  }

  if (option.provider === "openai") {
    const apiKey = byokKey || config.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        `${option.label} requires OPENAI_API_KEY. Set it in .env.local or paste a key via the model picker.`,
      );
    }
    return byokKey ? createOpenAI({ apiKey })(option.id) : openai(option.id);
  }

  // Google (Gemini)
  const apiKey = byokKey || config.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    throw new Error(
      `${option.label} requires GOOGLE_AI_API_KEY. Set it in .env.local or paste a key via the model picker.`,
    );
  }
  return byokKey ? createGoogleGenerativeAI({ apiKey })(option.id) : google(option.id);
}
