/**
 * @file Environment diagnostic script for Pocket CEP.
 *
 * Run with: npm run doctor (or: npx tsx src/lib/doctor.ts)
 *
 * Performs static and runtime checks on the environment to help developers
 * identify configuration issues before they become runtime errors. Each
 * check runs independently — a failure in one doesn't block the others.
 *
 * Exit code 0 = all checks passed, 1 = at least one failed.
 */

import { existsSync } from "fs";
import { resolve } from "path";
import { serverSchema } from "./env";
import { parseEnvFile } from "./env-flavors";
import { getErrorMessage } from "./errors";
import {
  PASS,
  FAIL,
  WARN,
  probeMcpServer,
  probeAnthropicKey,
  probeGeminiKey,
} from "./doctor-checks";

let passed = 0;
let failed = 0;

/**
 * Reports a check result and updates the counters.
 */
function report(ok: boolean, message: string) {
  if (ok) {
    console.log(`  ${PASS} ${message}`);
    passed++;
  } else {
    console.log(`  ${FAIL} ${message}`);
    failed++;
  }
}

/**
 * Loads env files the same way Next.js does: .env first, then .env.local
 * overrides. Reuses parseEnvFile from env-flavors.ts.
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

async function main() {
  console.log("\nPocket CEP Environment Check\n");

  console.log("Static checks:");

  const envPath = resolve(process.cwd(), ".env");
  const envLocalPath = resolve(process.cwd(), ".env.local");

  report(existsSync(envPath), ".env file found");
  report(existsSync(envLocalPath), ".env.local file found (secrets)");

  if (!existsSync(envLocalPath)) {
    console.log(`  ${WARN}   Copy .env.local.example to .env.local and fill in your secrets`);
  }

  const env = loadEnvFiles();
  const parseResult = serverSchema.safeParse(env);

  if (parseResult.success) {
    report(true, "Environment variables valid (Zod schema passed)");

    const data = parseResult.data;

    const isPlaceholder = data.BETTER_AUTH_SECRET === "please-change-me-to-a-real-secret";
    report(
      !isPlaceholder,
      isPlaceholder
        ? "BETTER_AUTH_SECRET is still the placeholder — run: openssl rand -base64 32"
        : "BETTER_AUTH_SECRET is set to a real value",
    );

    report(true, `AUTH_MODE: ${data.AUTH_MODE}`);
    report(true, `LLM_PROVIDER: ${data.LLM_PROVIDER}`);

    if (data.AUTH_MODE === "user_oauth") {
      report(true, `GOOGLE_CLIENT_ID: ${data.GOOGLE_CLIENT_ID}`);
    }
  } else {
    report(false, "Environment variable validation failed:");
    for (const issue of parseResult.error.issues) {
      console.log(`    - ${issue.path.join(".")}: ${issue.message}`);
    }
  }

  console.log("\nRuntime checks:");

  const mcpUrl = parseResult.success ? parseResult.data.MCP_SERVER_URL : env.MCP_SERVER_URL;
  if (mcpUrl) {
    const mcpResult = await probeMcpServer(mcpUrl);
    report(mcpResult.ok, mcpResult.message);
    if (!mcpResult.ok) {
      console.log(
        `  ${WARN}   Start it with: GCP_STDIO=false PORT=4000 npx @google/chrome-enterprise-premium-mcp@latest`,
      );
    }

    try {
      const { listMcpTools } = await import("./mcp-client");
      const tools = await listMcpTools(mcpUrl);
      report(true, `MCP server has ${tools.length} tools available`);
    } catch (error) {
      report(false, `MCP tool listing failed — ${getErrorMessage(error)}`);
    }
  } else {
    report(false, "MCP_SERVER_URL not configured");
  }

  if (parseResult.success) {
    const { LLM_PROVIDER, ANTHROPIC_API_KEY, GOOGLE_AI_API_KEY } = parseResult.data;

    if (LLM_PROVIDER === "claude" && ANTHROPIC_API_KEY) {
      const result = await probeAnthropicKey(ANTHROPIC_API_KEY);
      report(result.ok, result.message);
    }

    if (LLM_PROVIDER === "gemini" && GOOGLE_AI_API_KEY) {
      const result = await probeGeminiKey(GOOGLE_AI_API_KEY);
      report(result.ok, result.message);
    }
  }

  const total = passed + failed;
  console.log(
    `\nSummary: ${passed}/${total} checks passed.` +
      (failed > 0 ? " Fix the issues above before running the app." : " All good!") +
      "\n",
  );

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("Doctor script crashed:", error);
  process.exit(1);
});
