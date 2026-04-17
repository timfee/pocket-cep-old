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
 *
 * Anthropic's streaming protocol sends content in "blocks" — each block
 * has a start event, zero or more delta events, and a stop event. Tool
 * calls arrive as tool_use blocks whose input is streamed as partial JSON
 * fragments that must be accumulated before parsing.
 */

import Anthropic from "@anthropic-ai/sdk";
import { LOG_TAGS, DEFAULT_MODELS } from "../constants";
import type { LlmAdapter, LlmEvent, ChatMessage, ToolResult } from "./types";

/**
 * Creates a Claude adapter instance configured with the given API key
 * and optional model override. The returned adapter is stateless — it
 * creates a new streaming request on each runTurn() call.
 */
export function createClaudeAdapter(apiKey: string, model?: string): LlmAdapter {
  const anthropic = new Anthropic({ apiKey });
  const modelId = model || DEFAULT_MODELS.claude;

  return {
    async *runTurn({ systemPrompt, messages, tools, toolResults }) {
      const anthropicMessages = buildAnthropicMessages(messages, toolResults);

      /**
       * MCP and Anthropic both use JSON Schema for tool input definitions,
       * so the runtime shapes are identical. The TypeScript types don't
       * overlap, though, so this cast bridges the SDK boundary.
       */
      const anthropicTools: Anthropic.Tool[] = tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
      }));

      console.log(
        LOG_TAGS.CHAT,
        `Claude turn: ${anthropicMessages.length} messages, ${anthropicTools.length} tools`,
      );

      const stream = anthropic.messages.stream({
        model: modelId,
        max_tokens: 4096,
        system: systemPrompt,
        messages: anthropicMessages,
        tools: anthropicTools.length > 0 ? anthropicTools : undefined,
      });

      /**
       * Tool call inputs arrive as partial JSON fragments across multiple
       * delta events. We accumulate them keyed by block index, then parse
       * the complete JSON when the block stops.
       */
      const pendingToolCalls = new Map<number, { id: string; name: string; inputJson: string }>();

      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield { type: "text", text: event.delta.text } satisfies LlmEvent;
        }

        if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
          pendingToolCalls.set(event.index, {
            id: event.content_block.id,
            name: event.content_block.name,
            inputJson: "",
          });
        }

        if (event.type === "content_block_delta" && event.delta.type === "input_json_delta") {
          const pending = pendingToolCalls.get(event.index);
          if (pending) {
            pending.inputJson += event.delta.partial_json;
          }
        }

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

      /**
       * The stop reason is only available on the final assembled message,
       * not on individual streaming events. We await it after the stream
       * completes to determine if the model wants to call tools.
       */
      const finalMessage = await stream.finalMessage();
      const stopReason = finalMessage.stop_reason === "tool_use" ? "tool_use" : "end_turn";

      yield { type: "finish", stopReason } satisfies LlmEvent;
    },
  };
}

/**
 * Converts our generic message format into Anthropic's specific format.
 *
 * Anthropic has a unique convention for tool results: they're sent as a
 * "user" message containing an array of tool_result content blocks (not
 * a separate role). Each block references its tool_use by ID so the
 * model can correlate results with the calls it made.
 */
function buildAnthropicMessages(
  messages: ChatMessage[],
  toolResults?: ToolResult[],
): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = messages.map((msg) => ({
    role: msg.role,
    content: msg.content,
  }));

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
