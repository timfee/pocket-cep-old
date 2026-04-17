/**
 * @file Shared types for the LLM adapter layer.
 *
 * Defines the contract that both the Claude and Gemini adapters implement.
 * The agent loop in agent-loop.ts programs against these types, so swapping
 * between providers is just a matter of changing the LLM_PROVIDER env var.
 *
 * Extension point: to add a new LLM provider (e.g. Mistral, Llama), create
 * a new adapter file that implements LlmAdapter and register it in the
 * createAdapter() factory function in agent-loop.ts.
 */

/**
 * A tool definition in the format that both LLM adapters can consume.
 * These are converted from MCP tool schemas (which use JSON Schema) before
 * being passed to each provider's API — each adapter handles the final
 * translation to its provider-specific format (e.g. Anthropic's input_schema
 * vs Gemini's functionDeclarations).
 */
export type LlmTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

/**
 * A message in the conversation history. Uses the common subset of roles
 * supported by both Anthropic ("user"/"assistant") and Google ("user"/"model").
 * Each adapter maps "assistant" to whatever role name its API expects.
 */
export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

/**
 * Events yielded by the LLM adapter during streaming. The agent loop
 * consumes these to build SSE events for the frontend.
 *
 * The "finish" event's stopReason drives the loop: "tool_use" means the
 * LLM wants to call tools (loop continues), "end_turn" means it's done
 * (loop exits).
 */
export type LlmEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; name: string; input: Record<string, unknown> }
  | { type: "finish"; stopReason: "end_turn" | "tool_use" };

/**
 * The result of a tool call, fed back to the LLM so it can continue
 * reasoning with the tool's output. The result is always stringified JSON
 * because both Anthropic and Gemini expect string content for tool results.
 */
export type ToolResult = {
  toolCallId: string;
  result: string;
  isError: boolean;
};

/**
 * The contract that every LLM adapter must implement. The agent loop
 * calls runTurn() for each iteration, streaming events as they arrive.
 *
 * Adapters are stateless — all conversation context is passed in via
 * the params on each call. This simplifies the adapter implementations
 * and makes them easy to test in isolation.
 */
export type LlmAdapter = {
  /**
   * Runs one turn of conversation with the LLM. Yields events as the
   * model streams its response. If the model requests tool calls, the
   * finish event will have stopReason "tool_use" — the agent loop then
   * executes the tools and calls runTurn() again with the results.
   */
  runTurn(params: {
    systemPrompt: string;
    messages: ChatMessage[];
    tools: LlmTool[];
    toolResults?: ToolResult[];
  }): AsyncGenerator<LlmEvent>;
};
