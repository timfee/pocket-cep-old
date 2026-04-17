/**
 * @file API route to list available MCP tools.
 *
 * Returns the full list of tools from the MCP server, including their
 * names, descriptions, and input schemas. Used by the educational tools
 * catalog and to show what the agent can do.
 *
 * GET /api/tools -> { tools: McpToolDefinition[] }
 *
 * This endpoint makes a real MCP `tools/list` call to the upstream
 * server, so the results always reflect the server's current
 * capabilities. The response includes JSON Schema `inputSchema` for
 * each tool, which the frontend could use to render dynamic forms or
 * validation hints.
 *
 * Returns 502 if the MCP server is unreachable, giving the frontend a
 * clear signal to show a connection-error state rather than an empty
 * tool list.
 */

import { NextResponse } from "next/server";
import { listMcpTools } from "@/lib/mcp-client";
import { getGoogleAccessToken } from "@/lib/access-token";
import { getEnv } from "@/lib/env";
import { requireSession } from "@/lib/session";
import { LOG_TAGS } from "@/lib/constants";
import { getErrorMessage } from "@/lib/errors";

/**
 * Lists all MCP tools available on the Chrome Enterprise Premium server.
 * Requires an authenticated session; returns 401 otherwise.
 */
export async function GET() {
  if (!(await requireSession())) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const config = getEnv();
  const accessToken = await getGoogleAccessToken();

  try {
    const tools = await listMcpTools(config.MCP_SERVER_URL, accessToken);
    return NextResponse.json({ tools });
  } catch (error) {
    const message = getErrorMessage(error, "Failed to list tools");
    console.error(LOG_TAGS.MCP, "Failed to list tools:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
