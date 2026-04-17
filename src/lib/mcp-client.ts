/**
 * @file MCP client wrapper for connecting to the CEP MCP server over HTTP.
 *
 * Uses the official MCP SDK's StreamableHTTPClientTransport to send JSON-RPC
 * 2.0 requests to the server's POST /mcp endpoint. Each function creates a
 * fresh connection, executes the operation, and closes it — keeping things
 * stateless (the upstream server uses sessionIdGenerator: undefined).
 *
 * In user_oauth mode, the user's Google access token is injected as a Bearer
 * header so the MCP server can forward it to Google APIs.
 *
 * Extension point: to add retry logic or connection pooling, wrap the
 * callMcpTool function. The stateless design makes this straightforward.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { LOG_TAGS } from "./constants";

/**
 * Result from an MCP tool call, containing both the structured content
 * and the raw JSON-RPC request/response for the inspector panel.
 */
export type McpToolResult = {
  content: unknown;
  isError: boolean;
  /** The raw JSON-RPC request we sent (for educational display). */
  rawRequest: Record<string, unknown>;
  /** The raw JSON-RPC response we received (for educational display). */
  rawResponse: Record<string, unknown>;
};

/**
 * An MCP tool definition as returned by the server's listTools endpoint.
 */
export type McpToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

/**
 * Creates a connected MCP client pointed at the given server URL.
 * Injects the Bearer token if provided (user_oauth mode).
 */
async function connect(
  serverUrl: string,
  accessToken?: string,
): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
  const headers: Record<string, string> = {};

  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }

  const transport = new StreamableHTTPClientTransport(new URL(serverUrl), {
    requestInit: { headers },
  });

  const client = new Client({ name: "pocket-cep", version: "1.0.0" });
  await client.connect(transport);

  return { client, transport };
}

/**
 * Calls a single MCP tool on the remote server and returns the result
 * along with raw protocol data for the inspector panel.
 *
 * Creates a fresh connection per call (stateless). This matches how the
 * upstream server handles requests — no session persistence.
 */
export async function callMcpTool(
  serverUrl: string,
  toolName: string,
  args: Record<string, unknown>,
  accessToken?: string,
): Promise<McpToolResult> {
  const rawRequest = {
    jsonrpc: "2.0",
    method: "tools/call",
    params: { name: toolName, arguments: args },
  };

  console.log(LOG_TAGS.MCP, `Calling tool: ${toolName}`, JSON.stringify(args));

  const { client, transport } = await connect(serverUrl, accessToken);

  try {
    const result = await client.callTool({ name: toolName, arguments: args });

    const rawResponse = {
      jsonrpc: "2.0",
      result: {
        content: result.content,
        isError: result.isError ?? false,
      },
    };

    console.log(LOG_TAGS.MCP, `Tool ${toolName} completed. isError: ${result.isError ?? false}`);

    return {
      content: result.content,
      isError: Boolean(result.isError),
      rawRequest,
      rawResponse,
    };
  } finally {
    // Always clean up the connection, even if the call fails.
    await transport.close();
    await client.close();
  }
}

/**
 * Lists all tools available on the MCP server. Used to populate the
 * LLM's tool definitions and the educational tools catalog.
 */
export async function listMcpTools(
  serverUrl: string,
  accessToken?: string,
): Promise<McpToolDefinition[]> {
  console.log(LOG_TAGS.MCP, "Listing available tools...");

  const { client, transport } = await connect(serverUrl, accessToken);

  try {
    const result = await client.listTools();

    console.log(LOG_TAGS.MCP, `Found ${result.tools.length} tools`);

    return result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: (tool.inputSchema as Record<string, unknown>) ?? {
        type: "object",
        properties: {},
      },
    }));
  } finally {
    await transport.close();
    await client.close();
  }
}
