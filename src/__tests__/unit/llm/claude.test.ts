/**
 * @file Unit tests for the Claude LLM adapter.
 *
 * Mocks the Anthropic SDK to simulate streaming responses — both
 * text-only and tool-calling scenarios. Verifies that the adapter
 * correctly yields LlmEvent objects for each type of content block.
 *
 * Understanding the Anthropic streaming format is key: the SDK yields
 * events like content_block_start, content_block_delta, content_block_stop,
 * and message_stop. Our adapter translates these into our generic LlmEvent
 * types (text, tool_call, finish).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LlmEvent } from "@/lib/llm/types";

// Create mock stream objects that simulate the Anthropic SDK's streaming behavior.
function createMockStream(events: unknown[], finalMessage: unknown) {
  return {
    [Symbol.asyncIterator]: () => {
      let index = 0;
      return {
        next: async () => {
          if (index < events.length) {
            return { value: events[index++], done: false };
          }
          return { value: undefined, done: true };
        },
      };
    },
    finalMessage: () => Promise.resolve(finalMessage),
  };
}

const mockStream = vi.fn();

// Use a regular function (not arrow) so it works with `new Anthropic()`.
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn(function Anthropic() {
    return { messages: { stream: mockStream } };
  }),
}));

import { createClaudeAdapter } from "@/lib/llm/claude";
import { DEFAULT_MODELS } from "@/lib/constants";

describe("createClaudeAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("yields text events for a text-only response", async () => {
    // Simulate a simple text response from Claude.
    mockStream.mockReturnValue(
      createMockStream(
        [
          { type: "content_block_delta", delta: { type: "text_delta", text: "Hello " } },
          { type: "content_block_delta", delta: { type: "text_delta", text: "world!" } },
          { type: "message_stop" },
        ],
        { stop_reason: "end_turn" },
      ),
    );

    const adapter = createClaudeAdapter("test-key");
    const events: LlmEvent[] = [];

    for await (const event of adapter.runTurn({
      systemPrompt: "You are helpful.",
      messages: [{ role: "user", content: "Hi" }],
      tools: [],
    })) {
      events.push(event);
    }

    // Should get two text events and a finish event.
    expect(events).toEqual([
      { type: "text", text: "Hello " },
      { type: "text", text: "world!" },
      { type: "finish", stopReason: "end_turn" },
    ]);
  });

  it("yields tool_call events when Claude requests a tool", async () => {
    // Simulate Claude requesting a tool call.
    mockStream.mockReturnValue(
      createMockStream(
        [
          {
            type: "content_block_start",
            index: 0,
            content_block: { type: "tool_use", id: "toolu_123", name: "get_chrome_activity_log" },
          },
          {
            type: "content_block_delta",
            index: 0,
            delta: { type: "input_json_delta", partial_json: '{"userKey":' },
          },
          {
            type: "content_block_delta",
            index: 0,
            delta: { type: "input_json_delta", partial_json: '"all"}' },
          },
          { type: "content_block_stop", index: 0 },
          { type: "message_stop" },
        ],
        { stop_reason: "tool_use" },
      ),
    );

    const adapter = createClaudeAdapter("test-key");
    const events: LlmEvent[] = [];

    for await (const event of adapter.runTurn({
      systemPrompt: "You are helpful.",
      messages: [{ role: "user", content: "Show activity" }],
      tools: [
        {
          name: "get_chrome_activity_log",
          description: "Gets logs",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    })) {
      events.push(event);
    }

    // Should get a tool_call with the accumulated JSON input.
    expect(events).toEqual([
      {
        type: "tool_call",
        id: "toolu_123",
        name: "get_chrome_activity_log",
        input: { userKey: "all" },
      },
      { type: "finish", stopReason: "tool_use" },
    ]);
  });

  it("uses the default model when no override is provided", async () => {
    mockStream.mockReturnValue(
      createMockStream([{ type: "message_stop" }], { stop_reason: "end_turn" }),
    );

    const adapter = createClaudeAdapter("test-key");
    // Drain the generator.
    for await (const _ of adapter.runTurn({
      systemPrompt: "",
      messages: [{ role: "user", content: "Hi" }],
      tools: [],
    })) {
      // consume
    }

    // Verify the model was passed to the SDK.
    const callArgs = mockStream.mock.calls[0][0];
    expect(callArgs.model).toBe(DEFAULT_MODELS.claude);
  });

  it("uses a custom model when provided", async () => {
    mockStream.mockReturnValue(
      createMockStream([{ type: "message_stop" }], { stop_reason: "end_turn" }),
    );

    const adapter = createClaudeAdapter("test-key", "claude-opus-4-20250514");
    for await (const _ of adapter.runTurn({
      systemPrompt: "",
      messages: [{ role: "user", content: "Hi" }],
      tools: [],
    })) {
      // consume
    }

    const callArgs = mockStream.mock.calls[0][0];
    expect(callArgs.model).toBe("claude-opus-4-20250514");
  });
});
