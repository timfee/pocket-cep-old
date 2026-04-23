/**
 * @file Tests for renderEnvErrorHtml — the self-contained setup-required
 * page served by the proxy when env validation fails.
 */

import { describe, it, expect } from "vitest";
import { renderEnvErrorHtml } from "@/lib/env-error-page";

const ONE_ISSUE = [{ path: "BETTER_AUTH_SECRET", message: "required" }];
const TWO_ISSUES = [
  { path: "BETTER_AUTH_SECRET", message: "required" },
  { path: "ANTHROPIC_API_KEY", message: "expected string, received undefined" },
];

describe("renderEnvErrorHtml", () => {
  it("produces a well-formed HTML document", () => {
    const html = renderEnvErrorHtml(ONE_ISSUE);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html.trim().endsWith("</html>")).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("<title>Pocket CEP");
  });

  it("sets a viewport meta tag (mobile-safe)", () => {
    const html = renderEnvErrorHtml(ONE_ISSUE);
    expect(html).toContain('name="viewport"');
  });

  it("features `npm run setup` as the primary CTA", () => {
    const html = renderEnvErrorHtml(ONE_ISSUE);
    expect(html).toContain("npm run setup");
  });

  it("mentions .env.local.example as the hand-edit alternative", () => {
    const html = renderEnvErrorHtml(ONE_ISSUE);
    expect(html).toContain(".env.local.example");
  });

  it("renders one <li> per issue", () => {
    const html = renderEnvErrorHtml(TWO_ISSUES);
    const liCount = (html.match(/<li>/g) ?? []).length;
    expect(liCount).toBe(2);
    expect(html).toContain("BETTER_AUTH_SECRET");
    expect(html).toContain("ANTHROPIC_API_KEY");
    expect(html).toContain("expected string, received undefined");
  });

  it("still renders when there are zero issues (empty list)", () => {
    const html = renderEnvErrorHtml([]);
    expect(html).toContain("npm run setup");
    expect((html.match(/<li>/g) ?? []).length).toBe(0);
  });

  it("HTML-escapes malicious var names to prevent injection", () => {
    const html = renderEnvErrorHtml([{ path: "<script>alert(1)</script>", message: "ok" }]);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("HTML-escapes malicious messages to prevent injection", () => {
    const html = renderEnvErrorHtml([{ path: "X", message: '"><img src=x onerror=alert(1)>' }]);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&quot;&gt;&lt;img src=x onerror=alert(1)&gt;");
  });

  it("escapes ampersands to prevent entity confusion", () => {
    const html = renderEnvErrorHtml([{ path: "A&B", message: "C&D" }]);
    expect(html).toContain("A&amp;B");
    expect(html).toContain("C&amp;D");
  });

  it("sets the text/html content type implicitly via <!doctype html>", () => {
    // The proxy is responsible for the response header; this test
    // guards against the generator silently emitting anything else.
    const html = renderEnvErrorHtml(ONE_ISSUE);
    expect(html.slice(0, 15).toLowerCase()).toBe("<!doctype html>");
  });

  it("includes the MD3-aligned primary tint (#1a73e8)", () => {
    const html = renderEnvErrorHtml(ONE_ISSUE);
    expect(html).toContain("#1a73e8");
  });
});
