/**
 * @file Integration tests for the agent loop.
 *
 * Mocks both the LLM adapter and MCP client to test the full agent loop
 * orchestration: how it streams text, detects tool calls, executes them
 * via MCP, feeds results back to the LLM, and handles errors.
 *
 * The agent loop is the most complex piece of Pocket CEP — it's where
 * the LLM, MCP server, and SSE streaming all come together. These tests
 * ensure each scenario produces the correct sequence of AgentEvents.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentEvent } from "@/lib/agent-loop";

// Mock the MCP client.
const mockCallMcpTool = vi.fn();
const mockListMcpTools = vi.fn();

vi.mock("@/lib/mcp-client", () => ({
  callMcpTool: (...args: unknown[]) => mockCallMcpTool(...args),
  listMcpTools: (...args: unknown[]) => mockListMcpTools(...args),
}));

// Mock the LLM adapters. We'll control their output per test.
const mockRunTurn = vi.fn();

vi.mock("@/lib/llm/claude", () => ({
  createClaudeAdapter: () => ({ runTurn: mockRunTurn }),
}));

vi.mock("@/lib/llm/gemini", () => ({
  createGeminiAdapter: () => ({ runTurn: mockRunTurn }),
}));

// Mock env to provide valid config without real env vars.
vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    MCP_SERVER_URL: "http://localhost:3000/mcp",
    LLM_PROVIDER: "claude",
    LLM_MODEL: "",
    ANTHROPIC_API_KEY: "test-key",
    GOOGLE_AI_API_KEY: "",
  }),
}));

import { runAgentLoop, resetToolCache } from "@/lib/agent-loop";

/**
 * Helper to collect all events from the agent loop into an array.
 */
async function collectEvents(
  message: string,
  user: string,
  accessToken?: string,
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of runAgentLoop(message, user, [], accessToken)) {
    events.push(event);
  }
  return events;
}

describe("runAgentLoop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetToolCache();

    // Default: MCP server has one tool available.
    mockListMcpTools.mockResolvedValue([
      {
        name: "get_chrome_activity_log",
        description: "Gets activity logs",
        inputSchema: { type: "object", properties: {} },
      },
    ]);
  });

  it("yields text events then done for a simple text response", async () => {
    // LLM responds with plain text, no tool calls.
    mockRunTurn.mockImplementation(async function* () {
      yield { type: "text", text: "Everything looks fine." };
      yield { type: "finish", stopReason: "end_turn" };
    });

    const events = await collectEvents("How is this user?", "alice@test.com");

    expect(events.some((e) => e.type === "text")).toBe(true);
    expect(events[events.length - 1]).toEqual({ type: "done" });
  });

  it("executes tool calls and yields mcp_request/mcp_response events", async () => {
    // First turn: LLM requests a tool.
    // Second turn: LLM gives a text answer.
    let turnCount = 0;
    mockRunTurn.mockImplementation(async function* () {
      turnCount++;
      if (turnCount === 1) {
        yield {
          type: "tool_call",
          id: "call_1",
          name: "get_chrome_activity_log",
          input: { userKey: "alice@test.com" },
        };
        yield { type: "finish", stopReason: "tool_use" };
      } else {
        yield { type: "text", text: "Found 3 events." };
        yield { type: "finish", stopReason: "end_turn" };
      }
    });

    mockCallMcpTool.mockResolvedValue({
      content: [{ type: "text", text: "3 events found" }],
      isError: false,
      rawRequest: { jsonrpc: "2.0" },
      rawResponse: { jsonrpc: "2.0", result: {} },
    });

    const events = await collectEvents("Check activity", "alice@test.com");

    // Should see: tool_call → mcp_request → mcp_response → tool_result → text → done
    const types = events.map((e) => e.type);
    expect(types).toContain("tool_call");
    expect(types).toContain("mcp_request");
    expect(types).toContain("mcp_response");
    expect(types).toContain("tool_result");
    expect(types).toContain("text");
    expect(types[types.length - 1]).toBe("done");
  });

  it("yields error + done when MCP server is unreachable", async () => {
    // listMcpTools fails — server is down.
    mockListMcpTools.mockRejectedValue(new Error("Connection refused"));

    const events = await collectEvents("Check something", "bob@test.com");

    expect(events.some((e) => e.type === "error")).toBe(true);
    expect(events[events.length - 1]).toEqual({ type: "done" });
  });

  it("handles MCP tool call failures gracefully", async () => {
    let turnCount = 0;
    mockRunTurn.mockImplementation(async function* () {
      turnCount++;
      if (turnCount === 1) {
        yield { type: "tool_call", id: "call_1", name: "broken_tool", input: {} };
        yield { type: "finish", stopReason: "tool_use" };
      } else {
        yield { type: "text", text: "The tool failed, let me try something else." };
        yield { type: "finish", stopReason: "end_turn" };
      }
    });

    // MCP tool call throws.
    mockCallMcpTool.mockRejectedValue(new Error("Tool execution failed"));

    const events = await collectEvents("Do something", "test@test.com");

    // Should see an error tool_result but NOT crash the loop.
    const toolResult = events.find((e) => e.type === "tool_result" && e.isError);
    expect(toolResult).toBeDefined();

    // The loop should continue and eventually finish.
    expect(events[events.length - 1]).toEqual({ type: "done" });
  });
});
