/**
 * @file App-wide constants for Pocket CEP.
 *
 * Centralizes magic strings and configuration values so they can be
 * referenced consistently across server code, client components, and
 * diagnostic scripts.
 */

/**
 * Email domain for anonymous sessions in service_account mode.
 * BetterAuth's anonymous plugin generates emails like `anon-xyz@{domain}`.
 * The UI checks for this domain to display "Service Account" instead
 * of the generated email address.
 */
export const SA_EMAIL_DOMAIN = "service-account.local";

/**
 * Structured log prefixes for each subsystem. These make it easy to
 * filter server logs by component (e.g. `grep "\[mcp\]"`).
 */
export const LOG_TAGS = {
  MCP: "[mcp]",
  CHAT: "[chat]",
  AUTH: "[auth]",
  USERS: "[users]",
  ENV: "[env]",
  FLAVORS: "[flavors]",
} as const;

/**
 * Default model IDs used when LLM_MODEL is not set. Update these when
 * newer model versions are released and tested.
 */
export const DEFAULT_MODELS = {
  claude: "claude-sonnet-4-6",
  gemini: "gemini-2.5-flash",
} as const;

/**
 * Prevents runaway tool-calling loops where the LLM keeps requesting
 * tools without producing a final answer. 10 iterations allows complex
 * multi-step investigations while bounding cost and latency.
 */
export const MAX_AGENT_ITERATIONS = 10;

/**
 * Human-readable names for Chrome activity event types. Used by the
 * frontend to render event badges. The keys are the raw event type
 * strings returned by the Chrome Enterprise audit log API (and surfaced
 * through the MCP server's activity tools).
 */
export const EVENT_DISPLAY_NAMES: Record<string, string> = {
  browserCrashEvent: "Browser crash",
  browserExtensionInstallEvent: "Browser extension install",
  contentTransferEvent: "Content transfer",
  unscannedFileEvent: "Content unscanned",
  dangerousDownloadEvent: "Malware transfer",
  passwordChangedEvent: "Password changed",
  passwordReuseEvent: "Password reuse",
  sensitiveDataEvent: "Sensitive data transfer",
  interstitialEvent: "Unsafe site visit",
  urlFilteringInterstitialEvent: "URL filtering interstitial",
  suspiciousUrlEvent: "Suspicious URL",
} as const;

/**
 * Builds the system prompt injected into every LLM conversation. The
 * selectedUserEmail is interpolated so the LLM knows which user the
 * admin is investigating and can scope its MCP tool calls accordingly.
 */
export function buildSystemPrompt(selectedUserEmail: string): string {
  const userContext = selectedUserEmail
    ? `\nThe admin is investigating user "${selectedUserEmail}". When calling MCP tools,
always scope to this user:
- get_chrome_activity_log: use userKey="${selectedUserEmail}"
- check_user_cep_license: use userId="${selectedUserEmail}"
- Other tools: filter or focus on this user where applicable\n`
    : "";

  return `You are a Chrome Enterprise Premium admin assistant.
${userContext}
You have access to MCP tools from the Chrome Enterprise Premium server. Use them to:
- Check the user's recent Chrome activity (login events, policy violations, downloads)
- Verify their CEP license status
- Inspect DLP rules that may affect them
- Diagnose the environment health

Provide clear, educational explanations of:
- What each Chrome Enterprise feature does
- What the tool results mean in plain language
- What actions the admin might take to resolve issues

Be concise but thorough. When you find something noteworthy, explain WHY it matters.`;
}
