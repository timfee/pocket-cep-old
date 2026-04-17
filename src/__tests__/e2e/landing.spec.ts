/**
 * @file E2E tests for the landing page and authentication flow.
 *
 * These tests verify real browser behavior: page rendering, navigation,
 * OAuth redirect triggering, and route protection. They run against the
 * actual Next.js dev server.
 */

import { test, expect } from "@playwright/test";

test.describe("Landing page", () => {
  test("renders the full landing page with all expected elements", async ({ page }) => {
    await page.goto("/");

    // Title should be set via Next.js metadata
    await expect(page).toHaveTitle(/Pocket CEP/);

    // The sign-in button should be visible and clickable
    const signInButton = page.getByRole("button", { name: /Sign in with Google/i });
    await expect(signInButton).toBeVisible();
    await expect(signInButton).toBeEnabled();

    // The Google logo SVG should be inside the button (not a broken image)
    const googleLogo = signInButton.locator("svg");
    await expect(googleLogo).toBeVisible();

    // Description text should explain what the app does
    await expect(page.getByText(/Chrome Enterprise Premium/i)).toBeVisible();
    await expect(page.getByText(/MCP server/i).first()).toBeVisible();
  });

  test("sign-in button initiates Google OAuth redirect", async ({ page }) => {
    await page.goto("/");

    // Click sign-in and capture where it tries to navigate.
    // BetterAuth will redirect to /api/auth/sign-in/social which then
    // redirects to Google's OAuth consent screen.
    const [request] = await Promise.all([
      page.waitForRequest(
        (req) => req.url().includes("/api/auth/") || req.url().includes("accounts.google.com"),
      ),
      page.getByRole("button", { name: /Sign in with Google/i }).click(),
    ]);

    // The request should be heading toward BetterAuth's auth endpoint
    // or Google's OAuth endpoint — either proves the flow is wired up.
    const url = request.url();
    const isAuthFlow = url.includes("/api/auth/") || url.includes("accounts.google.com");
    expect(isAuthFlow).toBe(true);
  });
});

test.describe("Route protection", () => {
  test("unauthenticated /dashboard access redirects to landing page", async ({ page }) => {
    const response = await page.goto("/dashboard");

    // Should have been redirected to /
    await expect(page).toHaveURL("/");

    // The redirect chain should show a 307 from the proxy
    expect(response?.status()).toBe(200); // Final status after redirect
  });

  test("unauthenticated /dashboard/anything also redirects", async ({ page }) => {
    await page.goto("/dashboard/some-nested-path");
    await expect(page).toHaveURL("/");
  });

  test("API routes return 401 without a session", async ({ request }) => {
    // These should reject unauthenticated requests, not redirect.
    const usersResponse = await request.get("/api/users");
    expect(usersResponse.status()).toBe(401);

    const toolsResponse = await request.get("/api/tools");
    expect(toolsResponse.status()).toBe(401);

    const chatResponse = await request.post("/api/chat", {
      data: { message: "test", selectedUser: "test@test.com" },
    });
    expect(chatResponse.status()).toBe(401);
  });
});
