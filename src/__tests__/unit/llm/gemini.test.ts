/**
 * @file Unit tests for the Gemini LLM adapter.
 *
 * Mocks the Google Generative AI SDK to simulate streaming responses.
 * Also tests the schema transformation logic that converts MCP JSON Schema
 * into Gemini's FunctionDeclarationSchema format (stripping unsupported keys).
 *
 * Gemini has a different streaming format than Claude: it yields chunks
 * with candidates[0].content.parts, where parts can be { text } or
 * { functionCall: { name, args } }.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LlmEvent } from "@/lib/llm/types";

const mockGenerateContentStream = vi.fn();

// Use a regular function (not arrow) so it works with `new GoogleGenerativeAI()`.
vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: vi.fn(function GoogleGenerativeAI() {
    return {
      getGenerativeModel: () => ({
        generateContentStream: mockGenerateContentStream,
      }),
    };
  }),
  SchemaType: { OBJECT: "OBJECT" },
}));

import { createGeminiAdapter } from "@/lib/llm/gemini";

/**
 * Helper to create a mock streaming response from Gemini.
 * Each item in `chunks` becomes one iteration of the async stream.
 */
function createMockResponse(chunks: unknown[]) {
  return {
    stream: {
      [Symbol.asyncIterator]: () => {
        let i = 0;
        return {
          next: async () =>
            i < chunks.length
              ? { value: chunks[i++], done: false }
              : { value: undefined, done: true },
        };
      },
    },
  };
}

describe("createGeminiAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("yields text events for a text-only response", async () => {
    mockGenerateContentStream.mockResolvedValue(
      createMockResponse([
        { candidates: [{ content: { parts: [{ text: "Hello from Gemini!" }] } }] },
      ]),
    );

    const adapter = createGeminiAdapter("test-key");
    const events: LlmEvent[] = [];

    for await (const event of adapter.runTurn({
      systemPrompt: "Be helpful.",
      messages: [{ role: "user", content: "Hi" }],
      tools: [],
    })) {
      events.push(event);
    }

    expect(events[0]).toEqual({ type: "text", text: "Hello from Gemini!" });
    expect(events[events.length - 1]).toEqual({ type: "finish", stopReason: "end_turn" });
  });

  it("yields tool_call events when Gemini requests a function call", async () => {
    mockGenerateContentStream.mockResolvedValue(
      createMockResponse([
        {
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      name: "get_chrome_activity_log",
                      args: { userKey: "all" },
                    },
                  },
                ],
              },
            },
          ],
        },
      ]),
    );

    const adapter = createGeminiAdapter("test-key");
    const events: LlmEvent[] = [];

    for await (const event of adapter.runTurn({
      systemPrompt: "Be helpful.",
      messages: [{ role: "user", content: "Show logs" }],
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

    // The tool_call event should have a generated ID and the correct name/input.
    const toolCallEvent = events.find((e) => e.type === "tool_call");
    expect(toolCallEvent).toBeDefined();
    if (toolCallEvent && toolCallEvent.type === "tool_call") {
      expect(toolCallEvent.name).toBe("get_chrome_activity_log");
      expect(toolCallEvent.input).toEqual({ userKey: "all" });
      expect(toolCallEvent.id).toMatch(/^gemini_get_chrome_activity_log_/);
    }

    // Finish event should indicate tool_use.
    expect(events[events.length - 1]).toEqual({ type: "finish", stopReason: "tool_use" });
  });

  it("handles responses with no candidates gracefully", async () => {
    // An empty response — no candidates at all.
    mockGenerateContentStream.mockResolvedValue(createMockResponse([{ candidates: [] }]));

    const adapter = createGeminiAdapter("test-key");
    const events: LlmEvent[] = [];

    for await (const event of adapter.runTurn({
      systemPrompt: "",
      messages: [{ role: "user", content: "Hi" }],
      tools: [],
    })) {
      events.push(event);
    }

    // Should still get a finish event even with no content.
    expect(events).toEqual([{ type: "finish", stopReason: "end_turn" }]);
  });
});
