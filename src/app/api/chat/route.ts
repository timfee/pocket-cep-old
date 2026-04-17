/**
 * @file Streaming chat API route.
 *
 * Accepts a user message and selected user email, then runs the agent loop
 * which streams SSE events back to the client. The agent loop calls MCP
 * tools and feeds results back to the LLM.
 *
 * POST /api/chat
 * Body: { message: string, selectedUser: string, history: ChatMessage[] }
 * Response: SSE stream of AgentEvent objects
 *
 * The response uses Server-Sent Events (SSE) rather than WebSockets because
 * the communication is unidirectional (server -> client). Each SSE line is
 * a JSON-serialized AgentEvent. The ChatPanel component on the frontend
 * reads these events via a ReadableStream reader and updates the UI
 * incrementally (text chunks, tool calls, tool results, errors, done).
 *
 * Auth check happens first -- the BetterAuth session cookie is validated
 * server-side via `getSession`. In user_oauth mode, the Google access
 * token is extracted from the session and forwarded to the MCP server
 * as a Bearer header. In service_account mode, accessToken is undefined
 * and the MCP server uses its own ADC.
 *
 * The `history` field carries prior conversation turns so the LLM has
 * context. It is text-only (tool calls are not replayed) to keep payloads
 * small and avoid token-limit issues on long conversations.
 */

import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { runAgentLoop } from "@/lib/agent-loop";
import { getGoogleAccessToken } from "@/lib/access-token";
import { LOG_TAGS } from "@/lib/constants";
import { getErrorMessage } from "@/lib/errors";
import type { ChatMessage } from "@/lib/llm/types";

/**
 * Expected shape of the POST body. Fields are optional at the type level
 * because we validate them manually and return a 400 if missing, rather
 * than relying on Zod here (keeping the hot path lightweight).
 */
type ChatRequestBody = {
  message?: string;
  selectedUser?: string;
  history?: ChatMessage[];
};

/**
 * Handles a chat request: validates input, starts the agent loop, and
 * streams SSE events back to the client until the LLM finishes.
 */
export async function POST(request: Request) {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    return new Response(JSON.stringify({ error: "Not authenticated" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body: ChatRequestBody = await request.json();

  if (!body.message || !body.selectedUser) {
    return new Response(JSON.stringify({ error: "message and selectedUser are required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const accessToken = await getGoogleAccessToken();

  console.log(
    LOG_TAGS.CHAT,
    `Starting chat for user "${body.selectedUser}": "${body.message.slice(0, 100)}"`,
  );

  // Create a ReadableStream that writes SSE events from the agent loop.
  // Each event is a JSON object prefixed with "data: " and followed by
  // two newlines (standard SSE format).
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      try {
        for await (const event of runAgentLoop(
          body.message!,
          body.selectedUser!,
          body.history ?? [],
          accessToken,
        )) {
          const sseData = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(sseData));
        }
      } catch (error) {
        const message = getErrorMessage(error, "Agent loop failed");
        console.error(LOG_TAGS.CHAT, "Agent loop error:", message);
        const errorEvent = `data: ${JSON.stringify({ type: "error", message })}\n\n`;
        controller.enqueue(encoder.encode(errorEvent));
        const doneEvent = `data: ${JSON.stringify({ type: "done" })}\n\n`;
        controller.enqueue(encoder.encode(doneEvent));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
