/**
 * @file Unit tests for Zod environment variable validation.
 *
 * These tests verify that the env schema correctly validates, rejects, and
 * provides defaults for configuration. We test the schema directly (not the
 * lazy getEnv() singleton) to avoid side effects between tests.
 *
 * Why this matters: a misconfigured environment is the #1 source of confusing
 * errors in apps that talk to external services. Catching bad config at startup
 * with clear error messages saves hours of debugging.
 */

import { describe, it, expect } from "vitest";
import { serverSchema } from "@/lib/env";

/**
 * A complete, valid environment for the Claude + service_account configuration.
 * Tests that need to modify specific fields spread this and override.
 */
const VALID_CLAUDE_ENV = {
  AUTH_MODE: "service_account",
  BETTER_AUTH_SECRET: "test-secret-at-least-one-char",
  BETTER_AUTH_URL: "http://localhost:3000",
  GOOGLE_CLIENT_ID: "test-client-id",
  GOOGLE_CLIENT_SECRET: "test-client-secret",
  MCP_SERVER_URL: "http://localhost:4000/mcp",
  LLM_PROVIDER: "claude",
  LLM_MODEL: "",
  ANTHROPIC_API_KEY: "sk-ant-test-key",
  GOOGLE_AI_API_KEY: "",
};

/**
 * A valid environment for the Gemini + user_oauth configuration.
 */
const VALID_GEMINI_ENV = {
  ...VALID_CLAUDE_ENV,
  AUTH_MODE: "user_oauth",
  LLM_PROVIDER: "gemini",
  ANTHROPIC_API_KEY: "",
  GOOGLE_AI_API_KEY: "test-gemini-key",
};

describe("serverSchema", () => {
  describe("valid configurations", () => {
    it("accepts a complete Claude + service_account config", () => {
      const result = serverSchema.safeParse(VALID_CLAUDE_ENV);
      expect(result.success).toBe(true);
    });

    it("accepts a complete Gemini + user_oauth config", () => {
      const result = serverSchema.safeParse(VALID_GEMINI_ENV);
      expect(result.success).toBe(true);
    });

    it("applies default values when optional fields are omitted", () => {
      // Provide only the required fields — defaults should fill in the rest.
      const minimal = {
        BETTER_AUTH_SECRET: "my-secret",
        GOOGLE_CLIENT_ID: "my-id",
        GOOGLE_CLIENT_SECRET: "my-secret",
        ANTHROPIC_API_KEY: "sk-ant-key",
      };

      const result = serverSchema.safeParse(minimal);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.AUTH_MODE).toBe("service_account");
        expect(result.data.MCP_SERVER_URL).toBe("http://localhost:4000/mcp");
        expect(result.data.LLM_PROVIDER).toBe("claude");
        expect(result.data.BETTER_AUTH_URL).toBe("http://localhost:3000");
      }
    });
  });

  describe("required field validation", () => {
    it("rejects when BETTER_AUTH_SECRET is missing", () => {
      const { BETTER_AUTH_SECRET: _, ...env } = VALID_CLAUDE_ENV;
      const result = serverSchema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it("rejects when GOOGLE_CLIENT_ID is missing", () => {
      const env = { ...VALID_CLAUDE_ENV, GOOGLE_CLIENT_ID: "" };
      const result = serverSchema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it("rejects when GOOGLE_CLIENT_SECRET is missing", () => {
      const env = { ...VALID_CLAUDE_ENV, GOOGLE_CLIENT_SECRET: "" };
      const result = serverSchema.safeParse(env);
      expect(result.success).toBe(false);
    });
  });

  describe("conditional API key validation", () => {
    it("requires ANTHROPIC_API_KEY when LLM_PROVIDER is claude", () => {
      const env = { ...VALID_CLAUDE_ENV, ANTHROPIC_API_KEY: "" };
      const result = serverSchema.safeParse(env);
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message);
        expect(messages.some((m) => m.includes("ANTHROPIC_API_KEY"))).toBe(true);
      }
    });

    it("requires GOOGLE_AI_API_KEY when LLM_PROVIDER is gemini", () => {
      const env = { ...VALID_GEMINI_ENV, GOOGLE_AI_API_KEY: "" };
      const result = serverSchema.safeParse(env);
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message);
        expect(messages.some((m) => m.includes("GOOGLE_AI_API_KEY"))).toBe(true);
      }
    });

    it("does NOT require ANTHROPIC_API_KEY when LLM_PROVIDER is gemini", () => {
      // Gemini config with no Anthropic key should be fine.
      const result = serverSchema.safeParse(VALID_GEMINI_ENV);
      expect(result.success).toBe(true);
    });
  });

  describe("enum validation", () => {
    it("rejects invalid AUTH_MODE values", () => {
      const env = { ...VALID_CLAUDE_ENV, AUTH_MODE: "magic_tokens" };
      const result = serverSchema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it("rejects invalid LLM_PROVIDER values", () => {
      const env = { ...VALID_CLAUDE_ENV, LLM_PROVIDER: "gpt4" };
      const result = serverSchema.safeParse(env);
      expect(result.success).toBe(false);
    });
  });

  describe("URL validation", () => {
    it("rejects invalid MCP_SERVER_URL", () => {
      const env = { ...VALID_CLAUDE_ENV, MCP_SERVER_URL: "not-a-url" };
      const result = serverSchema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it("rejects invalid BETTER_AUTH_URL", () => {
      const env = { ...VALID_CLAUDE_ENV, BETTER_AUTH_URL: "just-text" };
      const result = serverSchema.safeParse(env);
      expect(result.success).toBe(false);
    });
  });
});
