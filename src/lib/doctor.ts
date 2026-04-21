/**
 * @file Environment diagnostic script for Pocket CEP.
 *
 * Run with: npm run doctor (or: npx tsx src/lib/doctor.ts)
 *
 * The doctor is flavor-aware: it tells you which of the four
 * mode × provider combinations is active (service_account|user_oauth
 * × claude|gemini), what that means in practice, and which runtime
 * probes matter for the active flavor.
 *
 * Output is grouped into sections so a failure is easy to locate:
 *   - Static (files + schema + placeholder secrets)
 *   - Google credentials (ADC — service_account only)
 *   - LLM provider (Anthropic or Google AI key)
 *   - MCP server (reachable + tool/prompt inventory)
 *
 * Independent probes fan out in parallel so the whole run is bounded
 * by the single slowest external call. Library log lines tagged with
 * LOG_TAGS are muted while probes run so they don't interleave with
 * the doctor's own output.
 *
 * Exit code 0 = all checks passed, 1 = at least one failed.
 */

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { serverSchema, type ServerEnv } from "./env";
import { getErrorMessage } from "./errors";
import { isAuthError } from "./auth-errors";
import { LOG_TAGS } from "./constants";
import { getDefaultModelId } from "./models";
import {
  PASS,
  FAIL,
  WARN,
  SKIP,
  probeMcpServer,
  probeAnthropicKey,
  probeGeminiKey,
  probeAdcToken,
  type CheckResult,
} from "./doctor-checks";

type Status = "pass" | "fail" | "warn" | "skip";

type CheckLine = {
  status: Status;
  title: string;
  /** Extra lines printed under the title, indented — used for fix/why. */
  details?: string[];
};

/**
 * Minimal .env parser — handles `KEY=VALUE`, blank lines, and `#` comments.
 * No quoting, no multiline, no variable expansion. We keep it trivial so
 * doctor's diagnostics aren't confounded by parser quirks.
 */
function parseEnvFile(filePath: string): Record<string, string> {
  const content = readFileSync(filePath, "utf-8");
  const env: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    env[trimmed.slice(0, eqIndex).trim()] = trimmed.slice(eqIndex + 1).trim();
  }
  return env;
}

/**
 * Loads env files the same way Next.js does: .env first, then .env.local
 * overrides. Starts from process.env so any shell-exported vars are
 * included too.
 */
function loadEnvFiles(): Record<string, string> {
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
  );

  for (const filename of [".env", ".env.local"]) {
    const filepath = resolve(process.cwd(), filename);
    if (!existsSync(filepath)) continue;
    Object.assign(env, parseEnvFile(filepath));
  }

  return env;
}

/**
 * Silences the structured library logs (`[auth]`, `[mcp]`, `[users]`, …)
 * so they don't interleave with the doctor's grouped output. Anything
 * without a known prefix is still printed so a library crash remains
 * visible. Returns a restore function.
 */
function muteLibraryLogs(): () => void {
  const knownPrefixes = Object.values(LOG_TAGS);
  const isTagged = (first: unknown) =>
    typeof first === "string" && knownPrefixes.some((tag) => first.startsWith(tag));

  const originalLog = console.log;
  const originalInfo = console.info;
  const originalError = console.error;
  const originalWarn = console.warn;

  const make = (original: typeof console.log) => {
    return (...args: unknown[]) => {
      if (args.length > 0 && isTagged(args[0])) return;
      original(...args);
    };
  };

  console.log = make(originalLog);
  console.info = make(originalInfo);
  console.error = make(originalError);
  console.warn = make(originalWarn);

  return () => {
    console.log = originalLog;
    console.info = originalInfo;
    console.error = originalError;
    console.warn = originalWarn;
  };
}

const ICON: Record<Status, string> = {
  pass: PASS,
  fail: FAIL,
  warn: WARN,
  skip: SKIP,
};

function printSection(title: string, subtitle: string, lines: CheckLine[]) {
  console.log(`\n${title}`);
  console.log(`  \x1b[2m${subtitle}\x1b[0m`);
  for (const line of lines) {
    console.log(`    ${ICON[line.status]} ${line.title}`);
    if (line.details) {
      for (const detail of line.details) {
        console.log(`         \x1b[2m${detail}\x1b[0m`);
      }
    }
  }
}

/**
 * Human-readable explanation of the active flavor. Two blurbs so new
 * engineers can see — just from doctor output — which of the four
 * mode × provider combinations the app will boot with.
 */
function printActiveFlavor(data: ServerEnv) {
  const authBlurb =
    data.AUTH_MODE === "service_account"
      ? "Server-side ADC authenticates every Google API call. No user sign-in; the dashboard loads directly as a shared 'service account' identity. Best for local demos and shared dev sessions."
      : "Users sign in with Google OAuth. Their access token is forwarded to the MCP server and carries their scopes. Best for per-user attribution and real admin setups.";

  const providerBlurb =
    data.LLM_PROVIDER === "claude"
      ? "Uses Anthropic's Claude via @ai-sdk/anthropic."
      : "Uses Google's Gemini via @ai-sdk/google.";

  const resolvedModel = data.LLM_MODEL || getDefaultModelId(data.LLM_PROVIDER);
  const modelSuffix = data.LLM_MODEL ? "(override)" : "(default)";

  console.log("\nActive flavor");
  console.log(`  AUTH_MODE    \x1b[36m${data.AUTH_MODE}\x1b[0m`);
  console.log(`    \x1b[2m${authBlurb}\x1b[0m`);
  console.log(`  LLM_PROVIDER \x1b[36m${data.LLM_PROVIDER}\x1b[0m`);
  console.log(`    \x1b[2m${providerBlurb}\x1b[0m`);
  console.log(`  LLM_MODEL    \x1b[36m${resolvedModel}\x1b[0m \x1b[2m${modelSuffix}\x1b[0m`);
}

/**
 * Turns a CheckResult into the display shape. Failures get a three-line
 * "error / fix / why" detail block; successes show the shortest useful
 * fact about what was actually exercised.
 */
function staticCheck(ok: boolean, title: string, detail?: string): CheckLine {
  return {
    status: ok ? "pass" : "fail",
    title,
    details: detail ? [detail] : undefined,
  };
}

function probeLine(result: CheckResult, why: string, fixHint?: string): CheckLine {
  if (result.ok) {
    return { status: "pass", title: result.message, details: why ? [why] : undefined };
  }
  return {
    status: "fail",
    title: result.message,
    details: [fixHint ?? "Fix the above and retry `npm run doctor`.", why].filter(Boolean),
  };
}

/**
 * Main diagnostic flow. Probes fan out in parallel; their results are
 * collected into section buffers and printed together at the end so
 * the output stays readable even under interleaved async.
 */
async function main() {
  console.log("\nPocket CEP Environment Check");

  const envPath = resolve(process.cwd(), ".env");
  const envLocalPath = resolve(process.cwd(), ".env.local");
  const envLocalPresent = existsSync(envLocalPath);

  const staticLines: CheckLine[] = [
    staticCheck(existsSync(envPath), ".env file found", ".env holds non-secret defaults."),
    staticCheck(
      envLocalPresent,
      ".env.local file found",
      envLocalPresent
        ? ".env.local holds your secrets. Not committed (gitignored)."
        : "Run: cp .env.local.example .env.local  — then add your BETTER_AUTH_SECRET and LLM key.",
    ),
  ];

  const env = loadEnvFiles();
  const parseResult = serverSchema.safeParse(env);

  if (!parseResult.success) {
    staticLines.push({
      status: "fail",
      title: "Environment variables failed validation",
      details: parseResult.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    });
    printSection("Static", "files + env schema", staticLines);
    finishWithSummary(countFailures(staticLines), countPasses(staticLines));
    return;
  }

  const data = parseResult.data;
  const isPlaceholder = data.BETTER_AUTH_SECRET === "please-change-me-to-a-real-secret";

  staticLines.push(
    staticCheck(true, "Environment variables valid (Zod schema passed)"),
    staticCheck(
      !isPlaceholder,
      isPlaceholder
        ? "BETTER_AUTH_SECRET is still the placeholder"
        : "BETTER_AUTH_SECRET is set to a real value",
      isPlaceholder
        ? "Generate a real secret with: openssl rand -base64 32"
        : "Rotating this invalidates every active session.",
    ),
  );

  printActiveFlavor(data);

  const restoreConsole = muteLibraryLogs();

  const needsAdc = data.AUTH_MODE === "service_account";
  const adcPromise: Promise<CheckResult | null> = needsAdc
    ? probeAdcToken()
    : Promise.resolve(null);

  const providerPromise: Promise<CheckResult> =
    data.LLM_PROVIDER === "claude"
      ? probeAnthropicKey(data.ANTHROPIC_API_KEY)
      : probeGeminiKey(data.GOOGLE_AI_API_KEY);

  const mcpPromise = probeMcpServer(data.MCP_SERVER_URL);

  const [adcResult, providerResult, mcpResult] = await Promise.all([
    adcPromise,
    providerPromise,
    mcpPromise,
  ]);

  const adcLines: CheckLine[] = [];
  if (adcResult) {
    adcLines.push(
      probeLine(
        adcResult,
        "Why: in service_account mode, the app uses your ADC token to call the Admin SDK and Admin Reports API.",
        "Fix: gcloud auth application-default login  (and set a quota project)",
      ),
    );
  } else {
    adcLines.push({
      status: "skip",
      title: "ADC probe skipped (user_oauth mode)",
      details: [
        "User OAuth mode uses the signed-in user's token instead of ADC.",
        "Switch to service_account mode in .env.local if you want ADC exercised.",
      ],
    });
  }

  const providerLines: CheckLine[] = [
    probeLine(
      providerResult,
      data.LLM_PROVIDER === "claude"
        ? "Why: the chat route calls @ai-sdk/anthropic on every message."
        : "Why: the chat route calls @ai-sdk/google on every message.",
      data.LLM_PROVIDER === "claude"
        ? "Fix: set ANTHROPIC_API_KEY in .env.local (https://console.anthropic.com/)"
        : "Fix: set GOOGLE_AI_API_KEY in .env.local (https://aistudio.google.com/apikey)",
    ),
  ];

  const mcpLines: CheckLine[] = [
    probeLine(
      mcpResult,
      "Why: every chat turn opens a fresh MCP connection to call tools and fetch prompts.",
      "Fix: npm run dev:full   (or start the MCP server separately on PORT=4000)",
    ),
  ];

  if (mcpResult.ok) {
    const { listMcpTools, listMcpPrompts } = await import("./mcp-client");
    const [toolsResult, promptsResult] = await Promise.allSettled([
      listMcpTools(data.MCP_SERVER_URL),
      listMcpPrompts(data.MCP_SERVER_URL),
    ]);

    mcpLines.push(
      toolsResult.status === "fulfilled"
        ? {
            status: "pass",
            title: `MCP tools/list returned ${toolsResult.value.length} tool${toolsResult.value.length === 1 ? "" : "s"}`,
            details: [
              "Each tool becomes a dynamicTool in the AI SDK. Model decides when to call them.",
            ],
          }
        : describeMcpFailure("tools/list", toolsResult.reason),
      promptsResult.status === "fulfilled"
        ? {
            status: "pass",
            title: `MCP prompts/list returned ${promptsResult.value.length} prompt${promptsResult.value.length === 1 ? "" : "s"}`,
            details: [
              "Server-authored conversation starters. Shown as cards on the empty chat panel.",
            ],
          }
        : describeMcpFailure("prompts/list", promptsResult.reason),
    );
  } else {
    mcpLines.push(
      { status: "skip", title: "MCP tools/list skipped (server not reachable)" },
      { status: "skip", title: "MCP prompts/list skipped (server not reachable)" },
    );
  }

  restoreConsole();

  printSection("Static", "files + env schema", staticLines);
  printSection(
    "Google credentials",
    needsAdc ? "ADC — service_account mode" : "User OAuth — ADC not used",
    adcLines,
  );
  printSection("LLM provider", `${data.LLM_PROVIDER} via Vercel AI SDK`, providerLines);
  printSection("MCP server", `JSON-RPC 2.0 over HTTP @ ${data.MCP_SERVER_URL}`, mcpLines);

  const allLines = [...staticLines, ...adcLines, ...providerLines, ...mcpLines];
  finishWithSummary(countFailures(allLines), countPasses(allLines));
}

function describeMcpFailure(method: string, reason: unknown): CheckLine {
  const message = isAuthError(reason) ? reason.displayMessage : getErrorMessage(reason);
  return {
    status: "fail",
    title: `MCP ${method} failed — ${message}`,
    details:
      isAuthError(reason) && reason.command
        ? [`Fix: ${reason.command}`, `Why: ${reason.remedy}`]
        : [`Why: the MCP server replied to ${method} with an error.`],
  };
}

function countPasses(lines: CheckLine[]) {
  return lines.filter((l) => l.status === "pass").length;
}

function countFailures(lines: CheckLine[]) {
  return lines.filter((l) => l.status === "fail").length;
}

function finishWithSummary(failures: number, passes: number) {
  const total = failures + passes;
  const verdict =
    failures > 0
      ? "Fix the ✗ lines above before running the app."
      : "All good — start the app with `npm run dev:full`.";
  const colour = failures > 0 ? "\x1b[31m" : "\x1b[32m";
  console.log(`\n${colour}Summary: ${passes}/${total} checks passed.\x1b[0m ${verdict}\n`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("Doctor script crashed:", error);
  process.exit(1);
});
