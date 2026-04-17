/**
 * @file Converts MCP tool definitions into AI SDK tool objects.
 */

import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { callMcpTool, listMcpTools } from "./mcp-client";
import { LOG_TAGS } from "./constants";

/**
 * Fetches all tools from the MCP server and wraps each as an AI SDK tool.
 */
export async function getMcpToolsForAiSdk(
  serverUrl: string,
  accessToken?: string,
): Promise<ToolSet> {
  const mcpTools = await listMcpTools(serverUrl, accessToken);
  const tools: ToolSet = {};

  for (const t of mcpTools) {
    tools[t.name] = tool({
      description: t.description,
      inputSchema: z.object({}).passthrough(),
      execute: async (args: Record<string, unknown>) => {
        console.log(LOG_TAGS.MCP, `Tool: ${t.name}`);
        const result = await callMcpTool(serverUrl, t.name, args, accessToken);
        return result.content;
      },
    });
  }

  return tools;
}
