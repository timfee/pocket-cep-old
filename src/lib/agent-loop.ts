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
 *
 * The loop is provider-agnostic — it programs against the LlmAdapter
 * interface (see llm/types.ts), so adding a new LLM provider doesn't
 * require changes here.
 */

import { callMcpTool, listMcpTools } from "./mcp-client";
import { createClaudeAdapter } from "./llm/claude";
import { createGeminiAdapter } from "./llm/gemini";
import { buildSystemPrompt, LOG_TAGS, MAX_AGENT_ITERATIONS } from "./constants";
import { getEnv } from "./env";
import { getErrorMessage } from "./errors";
import type { LlmAdapter, LlmTool, ChatMessage, ToolResult } from "./llm/types";

/**
 * SSE events sent from the agent loop to the frontend. Each event type
 * drives a different part of the UI:
 *   - text/tool_call/tool_result: the chat conversation panel
 *   - mcp_request/mcp_response: the educational protocol inspector
 *   - error/done: control flow signals
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
 * Factory that selects the LLM adapter based on LLM_PROVIDER.
 *
 * Extension point: to add a new LLM provider, create an adapter in
 * src/lib/llm/ that implements LlmAdapter, then add a case here.
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

  /**
   * Tool list is cached for 60s in service_account mode to avoid a full
   * MCP round-trip on every chat message. In user_oauth mode we skip the
   * cache because the access token is per-user and tool availability
   * could theoretically differ by user permissions.
   */
  let mcpTools: LlmTool[];
  try {
    if (!accessToken && toolCache && Date.now() < toolCache.expiresAt) {
      mcpTools = toolCache.tools;
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

  const messages: ChatMessage[] = [...conversationHistory, { role: "user", content: userMessage }];
  let toolResults: ToolResult[] | undefined;

  /**
   * The main loop: each iteration is one LLM turn. The LLM either
   * produces a final text response (end_turn) or requests tool calls
   * (tool_use). We execute the tools, feed results back, and loop.
   * MAX_AGENT_ITERATIONS prevents runaway loops.
   */
  for (let iteration = 0; iteration < MAX_AGENT_ITERATIONS; iteration++) {
    console.log(LOG_TAGS.CHAT, `Agent iteration ${iteration + 1}`);

    const pendingToolCalls: Array<{
      id: string;
      name: string;
      input: Record<string, unknown>;
    }> = [];

    let stopReason: "end_turn" | "tool_use" = "end_turn";

    try {
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
    } catch (error) {
      const msg = getErrorMessage(error);
      console.error(LOG_TAGS.CHAT, "LLM error:", msg);
      yield { type: "error", message: diagnoseLlmError(msg) };
      yield { type: "done" };
      return;
    }

    if (stopReason === "end_turn" || pendingToolCalls.length === 0) {
      yield { type: "done" };
      return;
    }

    /**
     * Execute each tool call sequentially. Parallel execution would be
     * possible but sequential is easier to follow in the inspector panel
     * and avoids concurrent request limits on the MCP server.
     */
    toolResults = [];

    for (const tc of pendingToolCalls) {
      yield { type: "mcp_request", payload: rawReqPayload(tc.name, tc.input) };

      try {
        const mcpResult = await callMcpTool(config.MCP_SERVER_URL, tc.name, tc.input, accessToken);

        yield { type: "mcp_response", payload: mcpResult.rawResponse };

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

        /**
         * Error results are still fed back to the LLM so it can
         * explain the failure to the user or try an alternative approach.
         */
        toolResults.push({
          toolCallId: tc.id,
          result: JSON.stringify({ error: errorMessage }),
          isError: true,
        });
      }
    }
  }

  console.warn(LOG_TAGS.CHAT, "Agent loop hit max iterations");
  yield { type: "text", text: "\n\n(Reached maximum tool call iterations)" };
  yield { type: "done" };
}

/** Builds a JSON-RPC-style request payload for the inspector panel. */
function rawReqPayload(name: string, args: Record<string, unknown>): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    method: "tools/call",
    params: { name, arguments: args },
  };
}

function diagnoseLlmError(msg: string): string {
  if (msg.includes("rate_limit") || msg.includes("429") || msg.includes("quota")) {
    return "LLM API rate limit or quota exceeded. Wait a moment and try again, or check your API plan limits.";
  }
  if (msg.includes("401") || msg.includes("authentication") || msg.includes("invalid_api_key")) {
    return "LLM API key is invalid or expired. Check your ANTHROPIC_API_KEY or GOOGLE_AI_API_KEY in .env.local.";
  }
  if (msg.includes("overloaded") || msg.includes("503")) {
    return "LLM API is temporarily overloaded. Try again in a few seconds.";
  }
  return `LLM error: ${msg}`;
}
