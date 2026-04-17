/**
 * @file App-wide constants for Pocket CEP.
 */

/**
 * Email domain for anonymous sessions in service_account mode.
 * Matched in the app bar to show "Service Account" instead of the
 * generated email address.
 */
export const SA_EMAIL_DOMAIN = "service-account.local";

/**
 * Structured log prefixes for each subsystem.
 */
export const LOG_TAGS = {
  MCP: "[mcp]",
  CHAT: "[chat]",
  AUTH: "[auth]",
  ENV: "[env]",
  FLAVORS: "[flavors]",
} as const;

/**
 * Default model IDs used when LLM_MODEL is not set.
 */
export const DEFAULT_MODELS = {
  claude: "claude-sonnet-4-20250514",
  gemini: "gemini-2.0-flash",
} as const;

/**
 * Prevents runaway tool-calling loops where the LLM keeps requesting
 * tools without producing a final answer.
 */
export const MAX_AGENT_ITERATIONS = 10;

/**
 * Human-readable names for Chrome activity event types.
 * Matches EVENT_NAME_MAPPING from the upstream MCP server.
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

export function buildSystemPrompt(selectedUserEmail: string): string {
  return `You are a Chrome Enterprise Premium admin assistant called "Pocket CEP."

The admin has selected user "${selectedUserEmail}" for investigation. When calling
activity log tools, filter for this user's email. When checking licenses or policies,
focus on this specific user.

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
