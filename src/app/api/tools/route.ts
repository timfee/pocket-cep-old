/**
 * @file API route to list available MCP tools.
 *
 * Returns the full list of tools from the MCP server, including their
 * names, descriptions, and input schemas. Used by the educational tools
 * catalog and to show what the agent can do.
 *
 * GET /api/tools → { tools: McpToolDefinition[] }
 */

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { listMcpTools } from "@/lib/mcp-client";
import { getGoogleAccessToken } from "@/lib/access-token";
import { getEnv } from "@/lib/env";
import { LOG_TAGS } from "@/lib/constants";
import { getErrorMessage } from "@/lib/errors";

export async function GET() {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
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
