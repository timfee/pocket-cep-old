/**
 * @file Integration test for GET /api/users/activity.
 *
 * Verifies the activity route (a) returns the grouped activity map on
 * success and (b) returns 401 with an AuthErrorPayload on auth failure
 * — no more silent 200-with-empty-map degradation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetSession, mockCallMcpTool, mockGetGoogleAccessToken, mockGetEnv } = vi.hoisted(
  () => ({
    mockGetSession: vi.fn(),
    mockCallMcpTool: vi.fn(),
    mockGetGoogleAccessToken: vi.fn(),
    mockGetEnv: vi.fn(),
  }),
);

vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { getSession: mockGetSession } }),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("@/lib/access-token", () => ({
  getGoogleAccessToken: mockGetGoogleAccessToken,
}));

vi.mock("@/lib/env", () => ({
  getEnv: mockGetEnv,
}));

vi.mock("@/lib/mcp-client", () => ({
  callMcpTool: mockCallMcpTool,
}));

import { GET } from "@/app/api/users/activity/route";
import { AuthError } from "@/lib/auth-errors";

describe("GET /api/users/activity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({ user: { id: "u1" } });
    mockGetEnv.mockReturnValue({ MCP_SERVER_URL: "http://localhost:4000/mcp" });
    // Unique per test to bypass the in-process cache.
    mockGetGoogleAccessToken.mockResolvedValue(`token-${Math.random()}`);
  });

  it("returns grouped activity on success", async () => {
    mockCallMcpTool.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            activities: [{ actor: { email: "a@x.test" }, id: { time: "2026-04-16T00:00:00Z" } }],
          }),
        },
      ],
      isError: false,
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activity["a@x.test"].eventCount).toBe(1);
  });

  it("returns 401 with AuthErrorPayload when MCP call throws AuthError", async () => {
    mockCallMcpTool.mockRejectedValue(
      new AuthError({
        code: "invalid_rapt",
        source: "mcp-tool",
        message: "Google requires you to re-authenticate.",
        remedy: "Run `gcloud auth login` and retry.",
        command: "gcloud auth login",
      }),
    );

    const res = await GET();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_rapt");
    expect(body.error.source).toBe("mcp-tool");
  });

  it("returns 200 with empty activity when MCP throws a non-auth error", async () => {
    mockCallMcpTool.mockRejectedValue(new Error("random MCP error"));

    const res = await GET();
    // Non-auth failures are still tolerable for this nice-to-have surface.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activity).toEqual({});
  });
});
