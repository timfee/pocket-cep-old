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
 */

import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { runAgentLoop } from "@/lib/agent-loop";
import { getGoogleAccessToken } from "@/lib/access-token";
import { LOG_TAGS } from "@/lib/constants";
import { getErrorMessage } from "@/lib/errors";
import type { ChatMessage } from "@/lib/llm/types";

/**
 * Expected shape of the POST body. We validate the required fields
 * before running the agent loop.
 */
type ChatRequestBody = {
  message?: string;
  selectedUser?: string;
  history?: ChatMessage[];
};

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
