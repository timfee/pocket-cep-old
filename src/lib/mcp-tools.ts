/**
 * @file Converts MCP tool definitions into AI SDK tool objects.
 *
 * MCP tools are discovered at runtime, so their input types aren't
 * known at build time. We wrap each one with the AI SDK's `dynamicTool`
 * and pass the server's JSON Schema through `jsonSchema()`.
 *
 * The catalog is cached in-process with a short TTL so every chat
 * request doesn't pay a listTools round trip. Cache keys include a
 * hash of the access token; `user_oauth` callers don't share catalogs
 * in case the CEP server's tool visibility diverges by scope.
 */

import { createHash } from "node:crypto";
import { dynamicTool, jsonSchema, type ToolSet } from "ai";
import type { JSONSchema7 } from "@ai-sdk/provider";
import { callMcpTool, listMcpTools, type McpToolDefinition } from "./mcp-client";
import { LOG_TAGS } from "./constants";

const TOOL_CATALOG_TTL_MS = 5 * 60 * 1000;

const toolCatalogCache = new Map<string, { tools: McpToolDefinition[]; expiresAt: number }>();

/**
 * Builds a cache key that isolates entries by (serverUrl, caller identity).
 * Service-account mode shares one entry (no token); user_oauth mode gets
 * a per-token entry keyed by a truncated SHA-256 so raw tokens never sit
 * in the Map.
 */
function cacheKey(serverUrl: string, accessToken: string | undefined): string {
  if (!accessToken) return `${serverUrl}|sa`;
  const hash = createHash("sha256").update(accessToken).digest("hex").slice(0, 16);
  return `${serverUrl}|u:${hash}`;
}

/**
 * Returns the MCP tool catalog, refreshing from the server at most once
 * per TTL window per caller identity.
 */
async function getCachedToolCatalog(
  serverUrl: string,
  accessToken: string | undefined,
): Promise<McpToolDefinition[]> {
  const key = cacheKey(serverUrl, accessToken);
  const now = Date.now();
  const cached = toolCatalogCache.get(key);
  if (cached && cached.expiresAt > now) return cached.tools;
  const tools = await listMcpTools(serverUrl, accessToken);
  toolCatalogCache.set(key, { tools, expiresAt: now + TOOL_CATALOG_TTL_MS });
  return tools;
}

/**
 * Drops cached catalogs. With no argument, clears everything. With a
 * serverUrl, drops every per-caller entry for that server (useful when
 * the upstream MCP server restarted with different tool code).
 */
export function invalidateToolCatalog(serverUrl?: string): void {
  if (!serverUrl) {
    toolCatalogCache.clear();
    return;
  }
  const prefix = `${serverUrl}|`;
  for (const key of toolCatalogCache.keys()) {
    if (key.startsWith(prefix)) toolCatalogCache.delete(key);
  }
}

/**
 * Fetches all tools from the MCP server (cached) and wraps each as an AI
 * SDK dynamic tool. The real JSON Schema from the MCP server is forwarded
 * so the model can generate well-formed arguments.
 */
export async function getMcpToolsForAiSdk(
  serverUrl: string,
  accessToken?: string,
): Promise<ToolSet> {
  const mcpTools = await getCachedToolCatalog(serverUrl, accessToken);
  const tools: ToolSet = {};

  for (const t of mcpTools) {
    tools[t.name] = dynamicTool({
      description: t.description,
      inputSchema: jsonSchema(t.inputSchema as JSONSchema7),
      execute: async (args) => {
        console.log(LOG_TAGS.MCP, `Tool: ${t.name}`);
        const result = await callMcpTool(
          serverUrl,
          t.name,
          args as Record<string, unknown>,
          accessToken,
        );
        return result.content;
      },
    });
  }

  return tools;
}
