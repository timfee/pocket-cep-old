/**
 * @file Streaming chat API route using the Vercel AI SDK.
 *
 * POST /api/chat
 * Body: { messages: UIMessage[], selectedUser: string }
 * Response: UI message stream (consumed by useChat on the frontend)
 */

import { streamText, convertToModelMessages, stepCountIs } from "ai";
import type { UIMessage } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { getGoogleAccessToken } from "@/lib/access-token";
import { getEnv } from "@/lib/env";
import { getMcpToolsForAiSdk } from "@/lib/mcp-tools";
import { buildSystemPrompt, LOG_TAGS, DEFAULT_MODELS, MAX_AGENT_ITERATIONS } from "@/lib/constants";
import { getErrorMessage } from "@/lib/errors";
import { isAuthError } from "@/lib/auth-errors";

export async function POST(request: Request) {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    return new Response(JSON.stringify({ error: "Not authenticated" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = await request.json();
  const { messages, selectedUser = "" }: { messages: UIMessage[]; selectedUser?: string } = body;

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

  const modelId = config.LLM_MODEL || DEFAULT_MODELS[config.LLM_PROVIDER];
  const model = config.LLM_PROVIDER === "gemini" ? google(modelId) : anthropic(modelId);

  const result = streamText({
    model,
    system: buildSystemPrompt(selectedUser),
    messages: await convertToModelMessages(messages),
    tools,
    stopWhen: stepCountIs(MAX_AGENT_ITERATIONS),
  });

  return result.toUIMessageStreamResponse();
}
