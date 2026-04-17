/**
 * @file Claude LLM adapter using the official Anthropic SDK.
 *
 * Implements the LlmAdapter interface for Claude models. Uses streaming
 * to yield text deltas and tool_use blocks as they arrive from the API.
 *
 * Key Anthropic API concepts used here:
 *   - messages.create with stream: true for real-time output
 *   - tool_use content blocks for function calling
 *   - tool_result messages to feed tool output back to the model
 */

import Anthropic from "@anthropic-ai/sdk";
import { LOG_TAGS, DEFAULT_MODELS } from "../constants";
import type { LlmAdapter, LlmEvent, ChatMessage, ToolResult } from "./types";

/**
 * Creates a Claude adapter instance configured with the given API key
 * and optional model override.
 */
export function createClaudeAdapter(apiKey: string, model?: string): LlmAdapter {
  const anthropic = new Anthropic({ apiKey });
  const modelId = model || DEFAULT_MODELS.claude;

  return {
    async *runTurn({ systemPrompt, messages, tools, toolResults }) {
      // Build the Anthropic messages array. We need to convert our generic
      // ChatMessage format into Anthropic's specific content block format.
      const anthropicMessages = buildAnthropicMessages(messages, toolResults);

      // Convert our generic tool definitions into Anthropic's format.
      // Anthropic uses "input_schema" (JSON Schema), which matches MCP directly.
      const anthropicTools: Anthropic.Tool[] = tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        // SDK boundary: MCP and Anthropic both use JSON Schema at runtime,
        // but their TS types don't overlap. This cast is unavoidable.
        input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
      }));

      console.log(
        LOG_TAGS.CHAT,
        `Claude turn: ${anthropicMessages.length} messages, ${anthropicTools.length} tools`,
      );

      // Stream the response. The SDK yields events as the model generates output.
      const stream = anthropic.messages.stream({
        model: modelId,
        max_tokens: 4096,
        system: systemPrompt,
        messages: anthropicMessages,
        tools: anthropicTools.length > 0 ? anthropicTools : undefined,
      });

      // Track tool calls as they come in so we can yield them as complete events.
      const pendingToolCalls = new Map<number, { id: string; name: string; inputJson: string }>();

      for await (const event of stream) {
        // Text delta — a chunk of the model's text response.
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield { type: "text", text: event.delta.text } satisfies LlmEvent;
        }

        // Tool use block starts — the model is calling a tool.
        if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
          pendingToolCalls.set(event.index, {
            id: event.content_block.id,
            name: event.content_block.name,
            inputJson: "",
          });
        }

        // Tool use input delta — accumulate the JSON input string.
        if (event.type === "content_block_delta" && event.delta.type === "input_json_delta") {
          const pending = pendingToolCalls.get(event.index);
          if (pending) {
            pending.inputJson += event.delta.partial_json;
          }
        }

        // Content block stop — if this was a tool_use block, yield the event.
        if (event.type === "content_block_stop") {
          const pending = pendingToolCalls.get(event.index);
          if (pending) {
            const input = pending.inputJson
              ? (JSON.parse(pending.inputJson) as Record<string, unknown>)
              : {};

            yield {
              type: "tool_call",
              id: pending.id,
              name: pending.name,
              input,
            } satisfies LlmEvent;

            pendingToolCalls.delete(event.index);
          }
        }
      }

      // Stop reason comes from the final message, not from streaming events.
      const finalMessage = await stream.finalMessage();
      const stopReason = finalMessage.stop_reason === "tool_use" ? "tool_use" : "end_turn";

      yield { type: "finish", stopReason } satisfies LlmEvent;
    },
  };
}

/**
 * Converts our generic message format into Anthropic's specific format.
 * Handles the special case of tool results, which Anthropic expects as
 * a "user" message containing tool_result content blocks.
 */
function buildAnthropicMessages(
  messages: ChatMessage[],
  toolResults?: ToolResult[],
): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = messages.map((msg) => ({
    role: msg.role,
    content: msg.content,
  }));

  // If we have tool results from the previous turn, append them.
  // Anthropic expects tool results as a "user" message with tool_result blocks.
  if (toolResults && toolResults.length > 0) {
    result.push({
      role: "user",
      content: toolResults.map((tr) => ({
        type: "tool_result" as const,
        tool_use_id: tr.toolCallId,
        content: tr.result,
        is_error: tr.isError,
      })),
    });
  }

  return result;
}
