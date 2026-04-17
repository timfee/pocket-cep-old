/**
 * @file Integration tests for user extraction from MCP activity logs.
 *
 * Tests the extractUsersFromActivities function that parses the MCP
 * server's activity log response and extracts unique user emails with
 * event counts. This is the core logic behind the user dropdown.
 *
 * We test the extraction logic directly (not through HTTP) because
 * Next.js API route handlers are hard to invoke in isolation without
 * spinning up the full server.
 */

import { describe, it, expect } from "vitest";
import { extractUsersFromActivities } from "@/app/api/users/route";

describe("extractUsersFromActivities", () => {
  it("extracts unique emails and counts from typical MCP content", () => {
    // The MCP server returns content as an array of { type: "text", text: "..." }
    // objects. The text contains formatted activity log entries.
    const content = [
      {
        type: "text",
        text:
          "## Chrome Activity Log (3 events)\n\n" +
          "- **2024-01-15T10:00:00Z** — actor: alice@example.com, events: browserCrashEvent, type: CHROME_OS\n" +
          "- **2024-01-15T11:00:00Z** — actor: bob@example.com, events: contentTransferEvent, type: CHROME_OS\n" +
          "- **2024-01-15T12:00:00Z** — actor: alice@example.com, events: sensitiveDataEvent, type: CHROME_OS",
      },
    ];

    const users = extractUsersFromActivities(content);

    // Alice has 2 events, Bob has 1 — Alice should be first (sorted by count).
    expect(users).toEqual([
      { email: "alice@example.com", eventCount: 2 },
      { email: "bob@example.com", eventCount: 1 },
    ]);
  });

  it("returns an empty array when there are no activities", () => {
    const users = extractUsersFromActivities([]);
    expect(users).toEqual([]);
  });

  it("returns an empty array when content is not an array", () => {
    const users = extractUsersFromActivities("not an array");
    expect(users).toEqual([]);
  });

  it("returns an empty array when content is null", () => {
    const users = extractUsersFromActivities(null);
    expect(users).toEqual([]);
  });

  it("skips content items without a text field", () => {
    const content = [
      { type: "image", data: "base64..." },
      {
        type: "text",
        text: "- **2024-01-15** — actor: alice@example.com, events: crash, type: CHROME",
      },
    ];

    const users = extractUsersFromActivities(content);
    expect(users).toEqual([{ email: "alice@example.com", eventCount: 1 }]);
  });

  it("handles multiple events per text block", () => {
    // Sometimes the MCP server returns multiple events in a single text block.
    const content = [
      {
        type: "text",
        text:
          "- actor: user1@test.com, events: crash\n" +
          "- actor: user2@test.com, events: transfer\n" +
          "- actor: user1@test.com, events: download\n" +
          "- actor: user3@test.com, events: crash\n" +
          "- actor: user1@test.com, events: reuse",
      },
    ];

    const users = extractUsersFromActivities(content);

    expect(users[0]).toEqual({ email: "user1@test.com", eventCount: 3 });
    expect(users).toHaveLength(3);
  });

  it("sorts users by event count descending", () => {
    const content = [
      {
        type: "text",
        text:
          "- actor: low@test.com, events: a\n" +
          "- actor: high@test.com, events: a\n" +
          "- actor: high@test.com, events: b\n" +
          "- actor: high@test.com, events: c\n" +
          "- actor: mid@test.com, events: a\n" +
          "- actor: mid@test.com, events: b",
      },
    ];

    const users = extractUsersFromActivities(content);
    const emails = users.map((u) => u.email);

    expect(emails).toEqual(["high@test.com", "mid@test.com", "low@test.com"]);
  });
});
