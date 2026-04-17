/**
 * @file Integration tests for user extraction from MCP responses.
 *
 * Tests extractActivityCounts which parses the MCP activity log and
 * produces email → event count mappings for the user dropdown.
 */

import { describe, it, expect } from "vitest";
import { extractActivityCounts } from "@/app/api/users/route";

/**
 * Helper: run extractActivityCounts and return sorted results as an array.
 */
function extractAndSort(content: unknown): Array<{ email: string; count: number }> {
  const counts = new Map<string, number>();
  extractActivityCounts(content, counts);
  return Array.from(counts.entries())
    .map(([email, count]) => ({ email, count }))
    .sort((a, b) => b.count - a.count);
}

describe("extractActivityCounts", () => {
  it("extracts unique emails and counts from typical MCP content", () => {
    const content = [
      {
        type: "text",
        text:
          "## Chrome Activity Log (3 events)\n\n" +
          "- **2024-01-15T10:00:00Z** — actor: alice@example.com, events: browserCrashEvent\n" +
          "- **2024-01-15T11:00:00Z** — actor: bob@example.com, events: contentTransferEvent\n" +
          "- **2024-01-15T12:00:00Z** — actor: alice@example.com, events: sensitiveDataEvent",
      },
    ];

    const users = extractAndSort(content);
    expect(users).toEqual([
      { email: "alice@example.com", count: 2 },
      { email: "bob@example.com", count: 1 },
    ]);
  });

  it("returns empty map when there are no activities", () => {
    expect(extractAndSort([])).toEqual([]);
  });

  it("handles non-array content gracefully", () => {
    expect(extractAndSort("not an array")).toEqual([]);
    expect(extractAndSort(null)).toEqual([]);
  });

  it("skips content items without a text field", () => {
    const content = [
      { type: "image", data: "base64..." },
      { type: "text", text: "- actor: alice@example.com, events: crash" },
    ];
    const users = extractAndSort(content);
    expect(users).toEqual([{ email: "alice@example.com", count: 1 }]);
  });

  it("handles multiple events per text block", () => {
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

    const users = extractAndSort(content);
    expect(users[0]).toEqual({ email: "user1@test.com", count: 3 });
    expect(users).toHaveLength(3);
  });

  it("accumulates counts into an existing map", () => {
    const counts = new Map<string, number>();
    counts.set("existing@test.com", 5);

    extractActivityCounts(
      [{ type: "text", text: "- actor: existing@test.com, events: a" }],
      counts,
    );

    expect(counts.get("existing@test.com")).toBe(6);
  });
});
