/**
 * @file Unit tests for the Zod environment validation schema.
 *
 * Tests the discriminated unions: auth mode (service_account vs user_oauth)
 * and LLM provider (claude vs gemini), plus format validation on the
 * Google OAuth Client ID.
 */

import { describe, it, expect } from "vitest";
import { serverSchema } from "@/lib/env";

const VALID_CLAUDE_SA = {
  AUTH_MODE: "service_account",
  BETTER_AUTH_SECRET: "test-secret",
  BETTER_AUTH_URL: "http://localhost:3000",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  MCP_SERVER_URL: "http://localhost:4000/mcp",
  LLM_PROVIDER: "claude",
  LLM_MODEL: "",
  ANTHROPIC_API_KEY: "sk-ant-test-key",
  GOOGLE_AI_API_KEY: "",
};

const VALID_GEMINI_OAUTH = {
  AUTH_MODE: "user_oauth",
  BETTER_AUTH_SECRET: "test-secret",
  BETTER_AUTH_URL: "http://localhost:3000",
  GOOGLE_CLIENT_ID: "123456789-abc123.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "GOCSPX-test",
  MCP_SERVER_URL: "http://localhost:4000/mcp",
  LLM_PROVIDER: "gemini",
  LLM_MODEL: "",
  ANTHROPIC_API_KEY: "",
  GOOGLE_AI_API_KEY: "test-gemini-key",
};

describe("serverSchema", () => {
  describe("valid configurations", () => {
    it("accepts Claude + service_account", () => {
      expect(serverSchema.safeParse(VALID_CLAUDE_SA).success).toBe(true);
    });

    it("accepts Gemini + user_oauth", () => {
      expect(serverSchema.safeParse(VALID_GEMINI_OAUTH).success).toBe(true);
    });

    it("accepts SA mode without any Google OAuth credentials", () => {
      const env = { ...VALID_CLAUDE_SA, GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "" };
      expect(serverSchema.safeParse(env).success).toBe(true);
    });

    it("applies defaults for optional fields", () => {
      const minimal = {
        BETTER_AUTH_SECRET: "my-secret",
        ANTHROPIC_API_KEY: "sk-ant-key",
      };
      const result = serverSchema.safeParse(minimal);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.AUTH_MODE).toBe("service_account");
        expect(result.data.LLM_PROVIDER).toBe("claude");
        expect(result.data.MCP_SERVER_URL).toBe("http://localhost:4000/mcp");
        expect(result.data.BETTER_AUTH_URL).toBe("http://localhost:3000");
      }
    });
  });

  describe("auth mode discriminant", () => {
    it("rejects user_oauth without GOOGLE_CLIENT_ID", () => {
      const env = { ...VALID_GEMINI_OAUTH, GOOGLE_CLIENT_ID: "" };
      const result = serverSchema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it("rejects user_oauth without GOOGLE_CLIENT_SECRET", () => {
      const env = { ...VALID_GEMINI_OAUTH, GOOGLE_CLIENT_SECRET: "" };
      const result = serverSchema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it("rejects user_oauth with malformed GOOGLE_CLIENT_ID", () => {
      const env = { ...VALID_GEMINI_OAUTH, GOOGLE_CLIENT_ID: "not-a-real-id" };
      const result = serverSchema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it("accepts user_oauth with correctly formatted GOOGLE_CLIENT_ID", () => {
      const env = {
        ...VALID_GEMINI_OAUTH,
        GOOGLE_CLIENT_ID:
          "226520923819-539vjitqbghl1uj9dv067jrd4lhcakog.apps.googleusercontent.com",
      };
      expect(serverSchema.safeParse(env).success).toBe(true);
    });
  });

  describe("LLM provider discriminant", () => {
    it("rejects claude without ANTHROPIC_API_KEY", () => {
      const env = { ...VALID_CLAUDE_SA, ANTHROPIC_API_KEY: "" };
      const result = serverSchema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it("rejects gemini without GOOGLE_AI_API_KEY", () => {
      const env = { ...VALID_GEMINI_OAUTH, GOOGLE_AI_API_KEY: "" };
      const result = serverSchema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it("does not require ANTHROPIC_API_KEY for gemini", () => {
      expect(serverSchema.safeParse(VALID_GEMINI_OAUTH).success).toBe(true);
    });

    it("does not require GOOGLE_AI_API_KEY for claude", () => {
      expect(serverSchema.safeParse(VALID_CLAUDE_SA).success).toBe(true);
    });
  });

  describe("format validation", () => {
    it("rejects invalid AUTH_MODE values", () => {
      const env = { ...VALID_CLAUDE_SA, AUTH_MODE: "magic_tokens" };
      expect(serverSchema.safeParse(env).success).toBe(false);
    });

    it("rejects invalid LLM_PROVIDER values", () => {
      const env = { ...VALID_CLAUDE_SA, LLM_PROVIDER: "gpt4" };
      expect(serverSchema.safeParse(env).success).toBe(false);
    });

    it("rejects invalid MCP_SERVER_URL", () => {
      const env = { ...VALID_CLAUDE_SA, MCP_SERVER_URL: "not-a-url" };
      expect(serverSchema.safeParse(env).success).toBe(false);
    });

    it("rejects missing BETTER_AUTH_SECRET", () => {
      const { BETTER_AUTH_SECRET: _, ...env } = VALID_CLAUDE_SA;
      expect(serverSchema.safeParse(env).success).toBe(false);
    });
  });
});
