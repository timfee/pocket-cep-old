/**
 * @file Unit tests for the ADC token helper.
 *
 * Mocks google-auth-library so we can force refresh-token failures and
 * verify that `getADCToken()` throws AuthError with the right code
 * instead of the previous silent-null behavior.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetAccessToken = vi.fn();
const mockGetClient = vi.fn();

vi.mock("google-auth-library", () => ({
  GoogleAuth: vi.fn(function GoogleAuth() {
    return { getClient: mockGetClient };
  }),
}));

import { getADCToken } from "@/lib/adc";
import { AuthError, isAuthError } from "@/lib/auth-errors";

describe("getADCToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetClient.mockResolvedValue({ getAccessToken: mockGetAccessToken });
  });

  it("returns the token string on success", async () => {
    mockGetAccessToken.mockResolvedValue({ token: "ya29.abc" });
    const token = await getADCToken();
    expect(token).toBe("ya29.abc");
  });

  it("throws AuthError(invalid_rapt) when refresh reports invalid_rapt", async () => {
    mockGetAccessToken.mockRejectedValue({
      message: "invalid_grant",
      response: {
        data: {
          error: "invalid_grant",
          error_subtype: "invalid_rapt",
          error_uri: "https://support.google.com/a/answer/9368756",
        },
      },
    });

    await expect(getADCToken()).rejects.toSatisfy((err: unknown) => {
      return isAuthError(err) && (err as AuthError).code === "invalid_rapt";
    });
  });

  it("throws AuthError(no_adc) when ADC is not configured", async () => {
    mockGetClient.mockRejectedValue(
      new Error("Could not load the default credentials. Browse to ..."),
    );

    await expect(getADCToken()).rejects.toSatisfy((err: unknown) => {
      return isAuthError(err) && (err as AuthError).code === "no_adc";
    });
  });

  it("rethrows non-auth errors untouched", async () => {
    const boom = new TypeError("unrelated failure");
    mockGetAccessToken.mockRejectedValue(boom);

    await expect(getADCToken()).rejects.toBe(boom);
  });

  it("throws AuthError(unknown_auth) when the token is empty", async () => {
    mockGetAccessToken.mockResolvedValue({ token: null });

    await expect(getADCToken()).rejects.toSatisfy((err: unknown) => {
      return isAuthError(err) && (err as AuthError).code === "unknown_auth";
    });
  });
});
