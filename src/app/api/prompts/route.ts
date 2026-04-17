/**
 * @file Proxies the MCP server's prompt endpoints.
 *
 * GET  /api/prompts  → `prompts/list` (cached 5 min per caller identity)
 * POST /api/prompts  → body { name, args? }, returns { text }. We call
 *                      the MCP server's `prompts/get` and concatenate
 *                      its user-role text so the caller can send it as
 *                      a single user turn.
 */

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import type { Prompt, PromptMessage } from "@modelcontextprotocol/sdk/types.js";
import { getAuth } from "@/lib/auth";
import { getGoogleAccessToken } from "@/lib/access-token";
import { getEnv } from "@/lib/env";
import { getMcpPrompt, listMcpPrompts } from "@/lib/mcp-client";
import { LOG_TAGS } from "@/lib/constants";
import { getErrorMessage } from "@/lib/errors";

const CATALOG_TTL_MS = 5 * 60 * 1000;

const promptCatalogCache = new Map<string, { data: Prompt[]; expiresAt: number }>();

function cacheKey(serverUrl: string, accessToken: string | undefined): string {
  if (!accessToken) return `${serverUrl}|sa`;
  const hash = createHash("sha256").update(accessToken).digest("hex").slice(0, 16);
  return `${serverUrl}|u:${hash}`;
}

async function requireSession() {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  return session;
}

export async function GET() {
  if (!(await requireSession())) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const config = getEnv();
  const accessToken = await getGoogleAccessToken();

  const key = cacheKey(config.MCP_SERVER_URL, accessToken);
  const now = Date.now();
  const cached = promptCatalogCache.get(key);
  if (cached && cached.expiresAt > now) {
    return NextResponse.json({ prompts: cached.data });
  }

  try {
    const prompts = await listMcpPrompts(config.MCP_SERVER_URL, accessToken);
    promptCatalogCache.set(key, { data: prompts, expiresAt: now + CATALOG_TTL_MS });
    return NextResponse.json({ prompts });
  } catch (error) {
    /**
     * Don't cache empties. During `npm run dev:full` the Next.js app
     * boots a beat before the MCP server, so the first call can
     * ECONNREFUSED while the server is still starting. Returning 503
     * (instead of a silent 200 with empty prompts) lets the client
     * retry and get the real catalog once MCP is up. Auth errors still
     * surface as part of the normal error message.
     */
    console.log(LOG_TAGS.MCP, "listMcpPrompts failed:", getErrorMessage(error));
    return NextResponse.json({ prompts: [], error: getErrorMessage(error) }, { status: 503 });
  }
}

/**
 * Expands a prompt by name. The response is the concatenated text of
 * the server's user-role messages — we punt on assistant-role messages
 * for now because Pocket CEP always injects prompts as a single user
 * turn. Multi-turn expansion can be added later if a prompt needs it.
 */
export async function POST(request: Request) {
  if (!(await requireSession())) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const config = getEnv();
  const accessToken = await getGoogleAccessToken();

  let body: { name?: string; args?: Record<string, string> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body?.name || typeof body.name !== "string") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  try {
    const messages: PromptMessage[] = await getMcpPrompt(
      config.MCP_SERVER_URL,
      body.name,
      body.args,
      accessToken,
    );

    /**
     * Concatenate user-role text only. Non-text content and
     * assistant/system roles are ignored; add threaded handling when
     * a server prompt needs it.
     */
    const text = messages
      .filter((m) => m.role === "user" && m.content.type === "text")
      .map((m) => (m.content.type === "text" ? m.content.text : ""))
      .join("\n\n");

    return NextResponse.json({ text });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 502 });
  }
}
