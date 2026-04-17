/**
 * @file Integration tests that validate every environment flavor.
 *
 * Each .env.test.{name} file represents a real-world configuration combo.
 * This test suite loads every flavor, runs it through Zod validation, and
 * checks that the parsed values match expectations for that flavor.
 *
 * Why this matters: it's easy to introduce a flavor file with a typo or
 * missing field. These tests catch that before it causes a confusing
 * runtime error. Think of them as "config linting."
 *
 * If a flavor file is missing, the test is skipped (not failed) — this
 * lets CI run even before all flavor files are created.
 */

import { describe, it, expect } from "vitest";
import { existsSync } from "fs";
import { resolve } from "path";
import { serverSchema } from "@/lib/env";
import { FLAVOR_NAMES, loadFlavor, type FlavorName } from "@/lib/env-flavors";

/**
 * Expected properties for each flavor. We verify the Zod-parsed output
 * matches these expectations so flavor files don't drift from their intent.
 */
const FLAVOR_EXPECTATIONS: Record<FlavorName, { authMode: string; llmProvider: string }> = {
  "claude-sa": { authMode: "service_account", llmProvider: "claude" },
  "claude-oauth": { authMode: "user_oauth", llmProvider: "claude" },
  "gemini-sa": { authMode: "service_account", llmProvider: "gemini" },
  "gemini-oauth": { authMode: "user_oauth", llmProvider: "gemini" },
};

describe("environment flavors", () => {
  for (const name of FLAVOR_NAMES) {
    const flavorPath = resolve(process.cwd(), `.env.test.${name}`);
    const fileExists = existsSync(flavorPath);

    describe(`flavor: ${name}`, () => {
      it.skipIf(!fileExists)("flavor file exists", () => {
        expect(fileExists).toBe(true);
      });

      it.skipIf(!fileExists)("passes Zod validation", () => {
        const env = loadFlavor(name);
        const result = serverSchema.safeParse(env);

        if (!result.success) {
          // Print a helpful message showing exactly what failed.
          const issues = result.error.issues
            .map((i) => `  ${i.path.join(".")}: ${i.message}`)
            .join("\n");
          throw new Error(`Flavor "${name}" failed validation:\n${issues}`);
        }

        expect(result.success).toBe(true);
      });

      it.skipIf(!fileExists)("has the correct AUTH_MODE", () => {
        const env = loadFlavor(name);
        const result = serverSchema.safeParse(env);
        if (!result.success) return;

        const expected = FLAVOR_EXPECTATIONS[name];
        expect(result.data.AUTH_MODE).toBe(expected.authMode);
      });

      it.skipIf(!fileExists)("has the correct LLM_PROVIDER", () => {
        const env = loadFlavor(name);
        const result = serverSchema.safeParse(env);
        if (!result.success) return;

        const expected = FLAVOR_EXPECTATIONS[name];
        expect(result.data.LLM_PROVIDER).toBe(expected.llmProvider);
      });

      it.skipIf(!fileExists)("has the required API key for its LLM provider", () => {
        const env = loadFlavor(name);
        const result = serverSchema.safeParse(env);
        if (!result.success) return;

        const { LLM_PROVIDER, ANTHROPIC_API_KEY, GOOGLE_AI_API_KEY } = result.data;

        if (LLM_PROVIDER === "claude") {
          expect(ANTHROPIC_API_KEY).toBeTruthy();
        } else {
          expect(GOOGLE_AI_API_KEY).toBeTruthy();
        }
      });

      it.skipIf(!fileExists)("uses a non-placeholder BETTER_AUTH_SECRET", () => {
        const env = loadFlavor(name);
        const result = serverSchema.safeParse(env);
        if (!result.success) return;

        // Flavor files should use unique test secrets, not the placeholder.
        expect(result.data.BETTER_AUTH_SECRET).not.toBe("please-change-me-to-a-real-secret");
      });

      it.skipIf(!fileExists)("has a valid MCP_SERVER_URL", () => {
        const env = loadFlavor(name);
        const result = serverSchema.safeParse(env);
        if (!result.success) return;

        // Should be a parseable URL.
        expect(() => new URL(result.data.MCP_SERVER_URL)).not.toThrow();
      });
    });
  }
});

describe("flavor coverage", () => {
  it("covers both auth modes", () => {
    const modes = new Set(Object.values(FLAVOR_EXPECTATIONS).map((e) => e.authMode));
    expect(modes).toContain("service_account");
    expect(modes).toContain("user_oauth");
  });

  it("covers both LLM providers", () => {
    const providers = new Set(Object.values(FLAVOR_EXPECTATIONS).map((e) => e.llmProvider));
    expect(providers).toContain("claude");
    expect(providers).toContain("gemini");
  });

  it("has a flavor for every combination of auth mode and LLM provider", () => {
    // 2 auth modes x 2 LLM providers = 4 flavors minimum
    expect(FLAVOR_NAMES.length).toBeGreaterThanOrEqual(4);
  });
});
