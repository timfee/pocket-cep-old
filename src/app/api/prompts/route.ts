/**
 * @file Returns the MCP server's prompt catalog and expands single prompts.
 *
 * GET  /api/prompts            → list available prompts (cached)
 * POST /api/prompts            → body { name, args? } returns expanded
 *                                messages. The server-authored prompt is
 *                                the authority on structure/tone/format.
 *
 * Pocket CEP uses this so the suggested-prompt cards represent real
 * server prompts (like `cep:health`) — clicking a card expands the
 * prompt server-side and sends the resulting text as a user message,
 * so the formatting contract encoded by the MCP server reaches the LLM.
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
    console.log(LOG_TAGS.MCP, "listMcpPrompts failed:", getErrorMessage(error));
    return NextResponse.json({ prompts: [] });
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
     * Pocket CEP injects prompts as a single user turn, so we
     * concatenate just the user-role text content. Non-text content
     * and assistant/system roles are ignored for now — we can thread
     * them through properly if a server prompt ever needs it.
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
