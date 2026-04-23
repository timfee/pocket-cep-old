/**
 * @file Renders a standalone HTML page describing environment
 * validation failures.
 *
 * Shipped by the proxy middleware so the user sees a friendly, styled
 * page with a clear call to action (`npm run setup`) instead of the
 * raw Next.js error overlay.
 *
 * Self-contained: no external fonts, no external CSS, no React. The
 * middleware runtime runs before the app bundle loads, so everything
 * a new contributor sees comes from the string this file returns.
 */

import type { EnvValidationIssue } from "@/lib/env";

/**
 * HTML-escapes a string so user-controlled content (env var names,
 * Zod messages) can't break out of the template.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Returns a full HTML document that lists the validation issues and
 * points the reader at `npm run setup`. Designed to be rendered as-is
 * by the middleware: no template engine, no asset pipeline.
 */
export function renderEnvErrorHtml(issues: ReadonlyArray<EnvValidationIssue>): string {
  const issueItems = issues
    .map(
      (i) =>
        `      <li><code class="var">${escapeHtml(i.path)}</code><span class="msg">${escapeHtml(i.message)}</span></li>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Pocket CEP — setup required</title>
<style>
  :root {
    --primary: #1a73e8;
    --primary-hover: #1557b0;
    --error: #d93025;
    --error-light: #fce8e6;
    --surface: #ffffff;
    --surface-dim: #f6f7f9;
    --surface-container: #edeff3;
    --on-surface: #1a1d21;
    --on-surface-variant: #4f5660;
    --on-surface-muted: #78808c;
    --outline: #d6dae0;
    --radius-sm: 8px;
    --radius-md: 12px;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Roboto", "Google Sans Text", ui-sans-serif, system-ui, sans-serif;
    font-size: 0.9375rem;
    line-height: 1.45;
    letter-spacing: -0.006em;
    color: var(--on-surface);
    background: var(--surface-dim);
    -webkit-font-smoothing: antialiased;
    min-height: 100dvh;
    display: grid;
    place-items: center;
    padding: 1.5rem;
  }
  main {
    max-width: 640px;
    width: 100%;
    background: var(--surface);
    border: 1px solid var(--outline);
    border-radius: var(--radius-md);
    box-shadow: 0 1px 2px rgb(11 18 32 / 0.06), 0 1px 3px rgb(11 18 32 / 0.04);
    padding: 2rem;
  }
  header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 0.5rem;
  }
  .glyph {
    width: 2rem;
    height: 2rem;
    flex-shrink: 0;
    border-radius: 999px;
    background: var(--error-light);
    color: var(--error);
    display: grid;
    place-items: center;
    font-weight: 700;
    font-size: 1rem;
  }
  h1 {
    font-size: 1.25rem;
    font-weight: 500;
    letter-spacing: -0.018em;
    margin: 0;
    text-wrap: balance;
  }
  p.lede {
    color: var(--on-surface-variant);
    margin: 0 0 1.5rem 2.75rem;
    text-wrap: pretty;
  }
  h2 {
    font-size: 0.6875rem;
    font-weight: 500;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: var(--on-surface-muted);
    margin: 1.5rem 0 0.5rem;
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0;
    border: 1px solid var(--outline);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  li {
    padding: 0.625rem 0.875rem;
    border-top: 1px solid color-mix(in srgb, var(--on-surface) 10%, transparent);
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }
  li:first-child { border-top: 0; }
  code.var {
    font-family: "Roboto Mono", ui-monospace, monospace;
    font-size: 0.8125rem;
    color: var(--error);
    font-weight: 500;
  }
  .msg {
    font-size: 0.875rem;
    color: var(--on-surface-variant);
  }
  .cta {
    margin-top: 1.5rem;
    padding: 1rem 1.125rem;
    background: var(--surface-dim);
    border: 1px solid var(--outline);
    border-radius: var(--radius-sm);
  }
  .cta p {
    margin: 0 0 0.625rem;
    font-size: 0.9375rem;
    text-wrap: pretty;
  }
  .cmd {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    background: var(--on-surface);
    color: var(--surface);
    font-family: "Roboto Mono", ui-monospace, monospace;
    font-size: 0.875rem;
    border-radius: var(--radius-sm);
    border: 0;
  }
  .cmd::before {
    content: "$";
    color: var(--on-surface-muted);
    font-weight: 500;
  }
  .alt {
    color: var(--on-surface-variant);
    font-size: 0.8125rem;
    margin-top: 0.625rem;
    margin-bottom: 0;
    text-wrap: pretty;
  }
  .alt code {
    font-family: "Roboto Mono", ui-monospace, monospace;
    background: var(--surface-container);
    padding: 0.0625rem 0.3125rem;
    border-radius: 4px;
    font-size: 0.8125rem;
  }
  footer {
    margin-top: 1.5rem;
    padding-top: 1rem;
    border-top: 1px solid color-mix(in srgb, var(--on-surface) 10%, transparent);
    color: var(--on-surface-muted);
    font-size: 0.8125rem;
    text-wrap: pretty;
  }
</style>
</head>
<body>
  <main>
    <header>
      <span class="glyph" aria-hidden="true">!</span>
      <h1>Environment setup required</h1>
    </header>
    <p class="lede">Pocket CEP can't start until the following environment variables are set in <code>.env.local</code>.</p>

    <h2>Missing or invalid</h2>
    <ul role="list">
${issueItems}
    </ul>

    <div class="cta">
      <p><strong>Run the guided setup.</strong> It walks through auth mode, API keys, and ADC — and validates each value against the real provider before writing.</p>
      <span class="cmd">npm run setup</span>
      <p class="alt">Prefer editing by hand? Copy <code>.env.local.example</code> to <code>.env.local</code> and fill in the blanks.</p>
    </div>

    <footer>Save <code>.env.local</code> and refresh this page.</footer>
  </main>
</body>
</html>`;
}
