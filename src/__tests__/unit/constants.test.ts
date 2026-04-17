/**
 * @file Unit tests for app-wide constants and the system prompt builder.
 *
 * These tests ensure that constants are defined correctly and that the
 * system prompt includes the selected user's email. The system prompt is
 * the "instructions" the LLM receives, so getting it right is critical
 * for the chat agent to investigate the correct user.
 */

import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt,
  LOG_TAGS,
  DEFAULT_MODELS,
  MAX_AGENT_ITERATIONS,
  EVENT_DISPLAY_NAMES,
} from "@/lib/constants";

describe("buildSystemPrompt", () => {
  it("includes the selected user's email address", () => {
    const prompt = buildSystemPrompt("alice@example.com");
    expect(prompt).toContain("alice@example.com");
  });

  it('identifies itself as "Pocket CEP"', () => {
    const prompt = buildSystemPrompt("test@test.com");
    expect(prompt).toContain("Pocket CEP");
  });

  it("mentions Chrome Enterprise concepts for context", () => {
    const prompt = buildSystemPrompt("test@test.com");
    // The prompt should give the LLM context about what tools are available.
    expect(prompt).toContain("activity");
    expect(prompt).toContain("DLP");
    expect(prompt).toContain("license");
  });
});

describe("LOG_TAGS", () => {
  it("has tags for all major subsystems", () => {
    expect(LOG_TAGS.MCP).toBe("[mcp]");
    expect(LOG_TAGS.CHAT).toBe("[chat]");
    expect(LOG_TAGS.AUTH).toBe("[auth]");
    expect(LOG_TAGS.ENV).toBe("[env]");
  });
});

describe("DEFAULT_MODELS", () => {
  it("has a default Claude model", () => {
    expect(DEFAULT_MODELS.claude).toBeTruthy();
    expect(typeof DEFAULT_MODELS.claude).toBe("string");
  });

  it("has a default Gemini model", () => {
    expect(DEFAULT_MODELS.gemini).toBeTruthy();
    expect(typeof DEFAULT_MODELS.gemini).toBe("string");
  });
});

describe("MAX_AGENT_ITERATIONS", () => {
  it("is a positive integer to prevent runaway loops", () => {
    expect(MAX_AGENT_ITERATIONS).toBeGreaterThan(0);
    expect(Number.isInteger(MAX_AGENT_ITERATIONS)).toBe(true);
  });
});

describe("EVENT_DISPLAY_NAMES", () => {
  it("maps known Chrome event types to human-readable names", () => {
    // Spot-check a few well-known event types from the upstream MCP server.
    expect(EVENT_DISPLAY_NAMES["browserCrashEvent"]).toBe("Browser crash");
    expect(EVENT_DISPLAY_NAMES["sensitiveDataEvent"]).toBe("Sensitive data transfer");
    expect(EVENT_DISPLAY_NAMES["dangerousDownloadEvent"]).toBe("Malware transfer");
  });

  it("has at least 10 event type mappings", () => {
    expect(Object.keys(EVENT_DISPLAY_NAMES).length).toBeGreaterThanOrEqual(10);
  });
});
