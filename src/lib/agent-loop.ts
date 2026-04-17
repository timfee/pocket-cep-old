/**
 * @file Core agent loop that orchestrates LLM ↔ MCP tool execution.
 *
 * This is the heart of Pocket CEP's chat feature. It runs entirely
 * server-side and works like this:
 *
 *   1. Send the user's message to the LLM along with available MCP tools.
 *   2. Stream text back to the client as the LLM generates it.
 *   3. If the LLM requests a tool call, execute it via the MCP client.
 *   4. Feed the tool result back to the LLM and repeat.
 *   5. Stop when the LLM produces a final text response (or we hit the
 *      iteration safety cap).
 *
 * Every step emits SSE events so the frontend can display both the
 * conversation and the raw MCP protocol traffic (educational inspector).
 */

import { callMcpTool, listMcpTools } from "./mcp-client";
import { createClaudeAdapter } from "./llm/claude";
import { createGeminiAdapter } from "./llm/gemini";
import { buildSystemPrompt, LOG_TAGS, MAX_AGENT_ITERATIONS } from "./constants";
import { getEnv } from "./env";
import { getErrorMessage } from "./errors";
import type { LlmAdapter, LlmTool, ChatMessage, ToolResult } from "./llm/types";

/**
 * SSE events sent from the agent loop to the frontend. These are JSON
 * objects written to the stream, one per line, prefixed with "data: ".
 */
export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; name: string; result: unknown; isError: boolean }
  | { type: "mcp_request"; payload: Record<string, unknown> }
  | { type: "mcp_response"; payload: Record<string, unknown> }
  | { type: "error"; message: string }
  | { type: "done" };

/**
 * Cached MCP tool list. The tool definitions don't change at runtime,
 * so we cache the first successful listMcpTools response and reuse it
 * for all subsequent chat messages. Cache is per-process (not per-user),
 * with a 60-second TTL to handle server restarts.
 */
let toolCache: { tools: LlmTool[]; expiresAt: number } | null = null;
const TOOL_CACHE_TTL_MS = 60_000;

/**
 * Resets the tool cache. Exported for use in tests that mock listMcpTools.
 */
export function resetToolCache() {
  toolCache = null;
}

/**
 * Creates the appropriate LLM adapter based on the LLM_PROVIDER env var.
 */
function createAdapter(): LlmAdapter {
  const config = getEnv();
  const model = config.LLM_MODEL || undefined;

  if (config.LLM_PROVIDER === "gemini") {
    return createGeminiAdapter(config.GOOGLE_AI_API_KEY, model);
  }

  return createClaudeAdapter(config.ANTHROPIC_API_KEY, model);
}

/**
 * Runs the agent loop, yielding SSE events as the LLM reasons and
 * calls MCP tools. This is an async generator — the caller writes
 * each yielded event to the HTTP response stream.
 *
 * The accessToken parameter is only used in user_oauth mode. In
 * service_account mode, the MCP server uses its own ADC.
 */
export async function* runAgentLoop(
  userMessage: string,
  selectedUser: string,
  conversationHistory: ChatMessage[],
  accessToken?: string,
): AsyncGenerator<AgentEvent> {
  const config = getEnv();
  const adapter = createAdapter();

  // Tool list is cached for 60s in service_account mode to avoid a full
  // MCP round-trip on every chat message. In user_oauth mode we skip the
  // cache because the access token is per-user.
  let mcpTools: LlmTool[];
  try {
    const useCache = !accessToken && toolCache && Date.now() < toolCache.expiresAt;
    if (useCache) {
      mcpTools = toolCache!.tools;
    } else {
      const rawTools = await listMcpTools(config.MCP_SERVER_URL, accessToken);
      mcpTools = rawTools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
      if (!accessToken) {
        toolCache = { tools: mcpTools, expiresAt: Date.now() + TOOL_CACHE_TTL_MS };
      }
    }
  } catch (error) {
    const message = getErrorMessage(error, "Unknown error connecting to MCP server");
    console.error(LOG_TAGS.CHAT, "Failed to list MCP tools:", message);
    yield { type: "error", message: `Cannot connect to MCP server: ${message}` };
    yield { type: "done" };
    return;
  }

  const systemPrompt = buildSystemPrompt(selectedUser);

  // Build the full message history with the new user message appended.
  const messages: ChatMessage[] = [...conversationHistory, { role: "user", content: userMessage }];

  // The agent loop: LLM generates → maybe calls tools → we feed results back.
  let toolResults: ToolResult[] | undefined;

  for (let iteration = 0; iteration < MAX_AGENT_ITERATIONS; iteration++) {
    console.log(LOG_TAGS.CHAT, `Agent iteration ${iteration + 1}`);

    // Collect tool calls from this turn so we can execute them after.
    const pendingToolCalls: Array<{
      id: string;
      name: string;
      input: Record<string, unknown>;
    }> = [];

    let stopReason: "end_turn" | "tool_use" = "end_turn";

    // Stream one turn of LLM output.
    for await (const event of adapter.runTurn({
      systemPrompt,
      messages,
      tools: mcpTools,
      toolResults,
    })) {
      if (event.type === "text") {
        yield { type: "text", text: event.text };
      }

      if (event.type === "tool_call") {
        pendingToolCalls.push({
          id: event.id,
          name: event.name,
          input: event.input,
        });
        yield { type: "tool_call", name: event.name, input: event.input };
      }

      if (event.type === "finish") {
        stopReason = event.stopReason;
      }
    }

    // If the LLM didn't request any tools, we're done.
    if (stopReason === "end_turn" || pendingToolCalls.length === 0) {
      yield { type: "done" };
      return;
    }

    // Execute each tool call against the MCP server.
    toolResults = [];

    for (const tc of pendingToolCalls) {
      // Emit the raw MCP request for the inspector panel.
      const rawReq = {
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: tc.name, arguments: tc.input },
      };
      yield { type: "mcp_request", payload: rawReq };

      try {
        const mcpResult = await callMcpTool(config.MCP_SERVER_URL, tc.name, tc.input, accessToken);

        // Emit the raw MCP response for the inspector panel.
        yield { type: "mcp_response", payload: mcpResult.rawResponse };

        // Emit a human-readable tool result for the chat UI.
        yield {
          type: "tool_result",
          name: tc.name,
          result: mcpResult.content,
          isError: mcpResult.isError,
        };

        toolResults.push({
          toolCallId: tc.id,
          result: JSON.stringify(mcpResult.content),
          isError: mcpResult.isError,
        });
      } catch (error) {
        const errorMessage = getErrorMessage(error, "MCP tool call failed");

        yield {
          type: "tool_result",
          name: tc.name,
          result: { error: errorMessage },
          isError: true,
        };

        toolResults.push({
          toolCallId: tc.id,
          result: JSON.stringify({ error: errorMessage }),
          isError: true,
        });
      }
    }
  }

  // Safety cap reached
  console.warn(LOG_TAGS.CHAT, "Agent loop hit max iterations");
  yield { type: "text", text: "\n\n(Reached maximum tool call iterations)" };
  yield { type: "done" };
}
