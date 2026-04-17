/**
 * @file Gemini LLM adapter using the official Google Generative AI SDK.
 *
 * Implements the LlmAdapter interface for Gemini models. Uses streaming
 * to yield text deltas and function calls as they arrive from the API.
 *
 * Key Gemini API concepts used here:
 *   - generateContentStream for real-time output
 *   - functionDeclarations for tool/function calling
 *   - FunctionResponse parts to feed tool output back to the model
 */

import {
  GoogleGenerativeAI,
  SchemaType,
  type FunctionDeclaration,
  type FunctionDeclarationSchema,
  type Content,
  type Part,
} from "@google/generative-ai";
import { LOG_TAGS, DEFAULT_MODELS } from "../constants";
import type { LlmAdapter, LlmEvent, ChatMessage, ToolResult } from "./types";

/**
 * Creates a Gemini adapter instance configured with the given API key
 * and optional model override.
 */
export function createGeminiAdapter(apiKey: string, model?: string): LlmAdapter {
  const genAI = new GoogleGenerativeAI(apiKey);
  const modelId = model || DEFAULT_MODELS.gemini;

  return {
    async *runTurn({ systemPrompt, messages, tools, toolResults }) {
      // Convert tool definitions into Gemini's functionDeclarations format.
      // This is a genuine SDK boundary: MCP uses JSON Schema (Record<string, unknown>)
      // while Gemini expects its own Schema type. The runtime shapes are compatible
      // but the TS types diverge, so we build typed FunctionDeclaration objects.
      const declarations: FunctionDeclaration[] = tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: toGeminiFunctionSchema(tool.inputSchema),
      }));

      const geminiTools = declarations.length > 0 ? [{ functionDeclarations: declarations }] : [];

      // Build the Gemini content array from our messages + tool results.
      const contents = buildGeminiContents(messages, toolResults);

      console.log(
        LOG_TAGS.CHAT,
        `Gemini turn: ${contents.length} content parts, ${tools.length} tools`,
      );

      // Get the generative model and start streaming.
      const generativeModel = genAI.getGenerativeModel({
        model: modelId,
        systemInstruction: systemPrompt,
        tools: geminiTools.length > 0 ? geminiTools : undefined,
      });

      const response = await generativeModel.generateContentStream({ contents });

      let hasToolCalls = false;

      for await (const chunk of response.stream) {
        // Check each candidate's content parts for text or function calls.
        for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
          if (part.text) {
            yield { type: "text", text: part.text } satisfies LlmEvent;
          }

          if (part.functionCall) {
            hasToolCalls = true;
            yield {
              type: "tool_call",
              // Gemini doesn't use IDs for function calls — we generate one
              // so the agent loop can match results back to calls.
              id: `gemini_${part.functionCall.name}_${Date.now()}`,
              name: part.functionCall.name,
              input: (part.functionCall.args as Record<string, unknown>) ?? {},
            } satisfies LlmEvent;
          }
        }
      }

      yield {
        type: "finish",
        stopReason: hasToolCalls ? "tool_use" : "end_turn",
      } satisfies LlmEvent;
    },
  };
}

/**
 * Converts our generic message format into Gemini's content format.
 * Gemini uses "user" and "model" roles (not "assistant"), and tool
 * results are sent as FunctionResponse parts.
 */
function buildGeminiContents(messages: ChatMessage[], toolResults?: ToolResult[]): Content[] {
  const contents: Content[] = messages.map((msg) => ({
    role: msg.role === "assistant" ? "model" : "user",
    parts: [{ text: msg.content }],
  }));

  // Tool results go as a "user" message with functionResponse parts.
  if (toolResults && toolResults.length > 0) {
    const parts: Part[] = toolResults.map((tr) => ({
      functionResponse: {
        name: tr.toolCallId.replace(/^gemini_/, "").replace(/_\d+$/, ""),
        response: { content: tr.result },
      },
    }));

    contents.push({ role: "function" as Content["role"], parts });
  }

  return contents;
}

/**
 * Converts an MCP JSON Schema into a Gemini FunctionDeclarationSchema.
 *
 * Gemini requires { type: SchemaType.OBJECT, properties: {...} } at minimum.
 * MCP schemas may include keywords Gemini doesn't support ("default",
 * "$schema", "additionalProperties"), so we strip those recursively.
 *
 * SDK boundary: MCP JSON Schema is Record<string, unknown> at the TS level,
 * while Gemini expects its own typed Schema hierarchy. The runtime shapes
 * are compatible (both are JSON Schema), so this cast is safe.
 */
function toGeminiFunctionSchema(schema: Record<string, unknown>): FunctionDeclarationSchema {
  const properties = schema["properties"];
  const cleanedProperties: Record<string, unknown> = {};

  if (properties && typeof properties === "object") {
    for (const [key, value] of Object.entries(properties)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        cleanedProperties[key] = stripUnsupportedKeys(value as Record<string, unknown>);
      } else {
        cleanedProperties[key] = value;
      }
    }
  }

  // The cast here is intentional: we've built a conformant object but
  // TypeScript can't verify the recursive Schema shape statically.
  return {
    type: SchemaType.OBJECT,
    properties: cleanedProperties,
  } as FunctionDeclarationSchema;
}

/**
 * Recursively removes JSON Schema keywords that Gemini doesn't support.
 */
const UNSUPPORTED_KEYS = new Set(["default", "$schema", "additionalProperties"]);

function stripUnsupportedKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (UNSUPPORTED_KEYS.has(key)) continue;

    if (value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = stripUnsupportedKeys(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }

  return result;
}
