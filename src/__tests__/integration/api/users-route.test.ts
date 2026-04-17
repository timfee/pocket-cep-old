/**
 * @file Integration test for GET /api/users.
 *
 * Verifies the happy path (200 with users) and the auth-failure path
 * (401 with a structured AuthError payload). Mocks BetterAuth and the
 * Admin SDK search so we can exercise the route handler directly.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// vi.hoisted ensures these are initialized before vi.mock factories run,
// since Vitest hoists vi.mock() calls to the top of the file.
const { mockGetSession, mockSearchUsers, mockGetGoogleAccessToken } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockSearchUsers: vi.fn(),
  mockGetGoogleAccessToken: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { getSession: mockGetSession } }),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("@/lib/access-token", () => ({
  getGoogleAccessToken: mockGetGoogleAccessToken,
}));

vi.mock("@/lib/admin-sdk", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin-sdk")>("@/lib/admin-sdk");
  return { ...actual, searchUsers: mockSearchUsers };
});

import { GET } from "@/app/api/users/route";
import { AuthError } from "@/lib/auth-errors";

describe("GET /api/users", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({ user: { id: "u1" } });
    mockGetGoogleAccessToken.mockResolvedValue(undefined);
  });

  function buildRequest(q = ""): NextRequest {
    const url = q
      ? `http://localhost/api/users?q=${encodeURIComponent(q)}`
      : "http://localhost/api/users";
    return new NextRequest(url);
  }

  it("returns 200 with users on success", async () => {
    mockSearchUsers.mockResolvedValue([{ email: "a@x.test", name: "Alice" }]);

    const res = await GET(buildRequest(""));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.users).toHaveLength(1);
    expect(body.users[0].email).toBe("a@x.test");
  });

  it("returns 401 with AuthErrorPayload when searchUsers throws AuthError", async () => {
    mockSearchUsers.mockRejectedValue(
      new AuthError({
        code: "invalid_rapt",
        source: "adc",
        message: "Google requires you to re-authenticate.",
        remedy: "Run `gcloud auth login` and retry.",
        command: "gcloud auth login",
      }),
    );

    const res = await GET(buildRequest(""));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toEqual({
      code: "invalid_rapt",
      source: "adc",
      message: "Google requires you to re-authenticate.",
      remedy: "Run `gcloud auth login` and retry.",
      command: "gcloud auth login",
      docsUrl: undefined,
    });
  });

  it("returns 500 on non-auth errors", async () => {
    mockSearchUsers.mockRejectedValue(new Error("kaboom"));

    const res = await GET(buildRequest(""));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("kaboom");
  });

  it("returns 401 when no session exists", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await GET(buildRequest(""));
    expect(res.status).toBe(401);
  });
});
