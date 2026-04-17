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
 *
 * Unlike Anthropic, Gemini does not assign IDs to function calls, so this
 * adapter synthesizes IDs (e.g. "gemini_toolName_timestamp") that the
 * agent loop can use to correlate results back to calls.
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
 * and optional model override. The returned adapter is stateless — it
 * creates a new streaming request on each runTurn() call.
 */
export function createGeminiAdapter(apiKey: string, model?: string): LlmAdapter {
  const genAI = new GoogleGenerativeAI(apiKey);
  const modelId = model || DEFAULT_MODELS.gemini;

  return {
    async *runTurn({ systemPrompt, messages, tools, toolResults }) {
      /**
       * Gemini uses its own FunctionDeclaration type rather than raw JSON
       * Schema. The shapes are compatible at runtime but the TS types
       * differ, so toGeminiFunctionSchema() handles the translation and
       * strips unsupported JSON Schema keywords.
       */
      const declarations: FunctionDeclaration[] = tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: toGeminiFunctionSchema(tool.inputSchema),
      }));

      const geminiTools = declarations.length > 0 ? [{ functionDeclarations: declarations }] : [];

      const contents = buildGeminiContents(messages, toolResults);

      console.log(
        LOG_TAGS.CHAT,
        `Gemini turn: ${contents.length} content parts, ${tools.length} tools`,
      );

      /**
       * Gemini's systemInstruction is set at model creation time (not per
       * request), so we create a fresh model instance for each turn. This
       * is lightweight — the actual API call happens in generateContentStream.
       */
      const generativeModel = genAI.getGenerativeModel({
        model: modelId,
        systemInstruction: systemPrompt,
        tools: geminiTools.length > 0 ? geminiTools : undefined,
      });

      const response = await generativeModel.generateContentStream({ contents });

      let hasToolCalls = false;

      for await (const chunk of response.stream) {
        for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
          if (part.text) {
            yield { type: "text", text: part.text } satisfies LlmEvent;
          }

          if (part.functionCall) {
            hasToolCalls = true;
            yield {
              type: "tool_call",
              /**
               * Synthetic ID: Gemini doesn't provide tool call IDs, but our
               * LlmEvent type requires one. The agent loop later strips this
               * prefix in buildGeminiContents to recover the original tool name
               * when sending results back.
               */
              id: `gemini_${part.functionCall.name}_${Date.now()}`,
              name: part.functionCall.name,
              input: (part.functionCall.args as Record<string, unknown>) ?? {},
            } satisfies LlmEvent;
          }
        }
      }

      /**
       * Gemini doesn't have an explicit stop_reason field like Anthropic.
       * Instead, we infer the stop reason from whether any function calls
       * appeared in the response.
       */
      yield {
        type: "finish",
        stopReason: hasToolCalls ? "tool_use" : "end_turn",
      } satisfies LlmEvent;
    },
  };
}

/**
 * Converts our generic message format into Gemini's content format.
 *
 * Key differences from Anthropic:
 *   - Role mapping: "assistant" -> "model"
 *   - Tool results use the special "function" role with FunctionResponse parts
 *   - The synthetic tool call IDs are stripped back to the original tool name
 *     using regex (removing the "gemini_" prefix and "_timestamp" suffix)
 */
function buildGeminiContents(messages: ChatMessage[], toolResults?: ToolResult[]): Content[] {
  const contents: Content[] = messages.map((msg) => ({
    role: msg.role === "assistant" ? "model" : "user",
    parts: [{ text: msg.content }],
  }));

  if (toolResults && toolResults.length > 0) {
    const parts: Part[] = toolResults.map((tr) => ({
      functionResponse: {
        /** Reverse the synthetic ID to recover the original tool name. */
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
 * "$schema", "additionalProperties"), so we strip those recursively via
 * stripUnsupportedKeys(). Without this cleaning, the Gemini API returns
 * opaque 400 errors.
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

  return {
    type: SchemaType.OBJECT,
    properties: cleanedProperties,
  } as FunctionDeclarationSchema;
}

/**
 * JSON Schema keywords that Gemini's FunctionDeclaration API does not
 * accept. If new keywords cause issues, add them here.
 */
const UNSUPPORTED_KEYS = new Set(["default", "$schema", "additionalProperties"]);

/**
 * Recursively removes unsupported JSON Schema keywords from a property
 * definition object, preserving all other fields.
 */
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
