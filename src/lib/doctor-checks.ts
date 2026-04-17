/**
 * @file Shared diagnostic check functions used by both doctor.ts and
 * doctor-flavors.ts. Keeps probe logic in one place so the fetch URLs,
 * headers, and validity criteria don't drift between the two scripts.
 */

import { getErrorMessage } from "./errors";

/**
 * Result of a single diagnostic check.
 */
export type CheckResult = { ok: boolean; message: string };

/**
 * Model used for the Anthropic API key probe. We use the cheapest model
 * to avoid burning tokens on a health check.
 */
const ANTHROPIC_PROBE_MODEL = "claude-haiku-4-5-20251001";

/**
 * Checks whether the MCP server is reachable at the given URL.
 * A GET request to /mcp should return 405 (POST only) — that
 * confirms the server is up and listening.
 */
export async function probeMcpServer(serverUrl: string): Promise<CheckResult> {
  try {
    const response = await fetch(serverUrl, { method: "GET" });
    const reachable = response.status === 405 || response.status === 200;
    return {
      ok: reachable,
      message: reachable
        ? `MCP server reachable at ${serverUrl} (status: ${response.status})`
        : `MCP server returned unexpected status ${response.status} at ${serverUrl}`,
    };
  } catch (error) {
    return {
      ok: false,
      message: `MCP server not reachable at ${serverUrl} — ${getErrorMessage(error)}`,
    };
  }
}

/**
 * Probes an Anthropic API key by sending a minimal request.
 * A 200 or 400/422 means the key is valid (bad request shape is fine).
 * Only 401/403 means the key is rejected.
 */
export async function probeAnthropicKey(apiKey: string): Promise<CheckResult> {
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_PROBE_MODEL,
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
    });

    const valid = response.status !== 401 && response.status !== 403;
    return {
      ok: valid,
      message: valid
        ? `Anthropic API key accepted (status: ${response.status})`
        : `Anthropic API key rejected (status: ${response.status})`,
    };
  } catch (error) {
    return { ok: false, message: `Anthropic API probe failed — ${getErrorMessage(error)}` };
  }
}

/**
 * Probes a Google AI API key by listing available models.
 * A 200 means the key is valid.
 */
export async function probeGeminiKey(apiKey: string): Promise<CheckResult> {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
    );

    const valid = response.status === 200;
    return {
      ok: valid,
      message: valid
        ? "Google AI API key accepted"
        : `Google AI API key rejected (status: ${response.status})`,
    };
  } catch (error) {
    return { ok: false, message: `Google AI API probe failed — ${getErrorMessage(error)}` };
  }
}
