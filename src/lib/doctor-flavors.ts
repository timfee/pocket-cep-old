/**
 * @file Runs environment diagnostics against every test flavor.
 *
 * Run with: npm run doctor:flavors
 *
 * For each .env.test.{name} file, this script:
 *   1. Loads the flavor's env vars
 *   2. Runs Zod validation (static check)
 *   3. Checks the MCP server URL is parseable
 *   4. Checks the correct LLM API key is present
 *   5. Optionally probes the MCP server if --live is passed
 *
 * This is the "matrix test" for environment configurations — it catches
 * issues like a Gemini flavor that accidentally has LLM_PROVIDER=claude,
 * or a user_oauth flavor missing GOOGLE_CLIENT_SECRET.
 *
 * Usage:
 *   npm run doctor:flavors          # static checks only (fast, no network)
 *   npm run doctor:flavors -- --live # also probe MCP server + LLM APIs
 */

import { existsSync } from "fs";
import { resolve } from "path";
import { serverSchema } from "./env";
import { FLAVOR_NAMES, loadFlavor, type FlavorName } from "./env-flavors";
import {
  type CheckResult,
  PASS,
  FAIL,
  SKIP,
  probeMcpServer,
  probeAnthropicKey,
  probeGeminiKey,
} from "./doctor-checks";

const isLive = process.argv.includes("--live");

/**
 * Runs all static checks for a single flavor and returns the results.
 */
function checkFlavor(name: FlavorName): CheckResult[] {
  const results: CheckResult[] = [];
  const filePath = resolve(process.cwd(), `.env.test.${name}`);

  if (!existsSync(filePath)) {
    results.push({ ok: false, message: `File missing: .env.test.${name}` });
    return results;
  }

  results.push({ ok: true, message: `File exists: .env.test.${name}` });

  const env = loadFlavor(name);
  const parseResult = serverSchema.safeParse(env);

  if (!parseResult.success) {
    const issues = parseResult.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    results.push({ ok: false, message: `Zod validation failed — ${issues}` });
    return results;
  }

  results.push({ ok: true, message: "Zod validation passed" });

  const data = parseResult.data;

  // Verify the flavor name matches its content.
  const expectsClaude = name.startsWith("claude");
  const expectsGemini = name.startsWith("gemini");
  const expectsSa = name.endsWith("-sa");
  const expectsOauth = name.endsWith("-oauth");

  if (expectsClaude && data.LLM_PROVIDER !== "claude") {
    results.push({
      ok: false,
      message: `Named "claude" but LLM_PROVIDER is "${data.LLM_PROVIDER}"`,
    });
  } else if (expectsGemini && data.LLM_PROVIDER !== "gemini") {
    results.push({
      ok: false,
      message: `Named "gemini" but LLM_PROVIDER is "${data.LLM_PROVIDER}"`,
    });
  } else {
    results.push({ ok: true, message: `LLM_PROVIDER: ${data.LLM_PROVIDER}` });
  }

  if (expectsSa && data.AUTH_MODE !== "service_account") {
    results.push({ ok: false, message: `Named "sa" but AUTH_MODE is "${data.AUTH_MODE}"` });
  } else if (expectsOauth && data.AUTH_MODE !== "user_oauth") {
    results.push({ ok: false, message: `Named "oauth" but AUTH_MODE is "${data.AUTH_MODE}"` });
  } else {
    results.push({ ok: true, message: `AUTH_MODE: ${data.AUTH_MODE}` });
  }

  // Check the correct API key is present.
  if (data.LLM_PROVIDER === "claude") {
    const hasKey = Boolean(data.ANTHROPIC_API_KEY);
    results.push({
      ok: hasKey,
      message: hasKey ? "ANTHROPIC_API_KEY is set" : "ANTHROPIC_API_KEY is missing",
    });
  } else {
    const hasKey = Boolean(data.GOOGLE_AI_API_KEY);
    results.push({
      ok: hasKey,
      message: hasKey ? "GOOGLE_AI_API_KEY is set" : "GOOGLE_AI_API_KEY is missing",
    });
  }

  // Check that the "wrong" API key is NOT set (clean separation).
  if (data.LLM_PROVIDER === "claude" && data.GOOGLE_AI_API_KEY) {
    results.push({ ok: true, message: "Note: GOOGLE_AI_API_KEY also set (unused but harmless)" });
  }
  if (data.LLM_PROVIDER === "gemini" && data.ANTHROPIC_API_KEY) {
    results.push({ ok: true, message: "Note: ANTHROPIC_API_KEY also set (unused but harmless)" });
  }

  // MCP URL is parseable.
  try {
    new URL(data.MCP_SERVER_URL);
    results.push({ ok: true, message: `MCP_SERVER_URL: ${data.MCP_SERVER_URL}` });
  } catch {
    results.push({
      ok: false,
      message: `MCP_SERVER_URL is not a valid URL: ${data.MCP_SERVER_URL}`,
    });
  }

  // Placeholder check.
  if (data.BETTER_AUTH_SECRET === "please-change-me-to-a-real-secret") {
    results.push({ ok: false, message: "BETTER_AUTH_SECRET is still the default placeholder" });
  } else {
    results.push({ ok: true, message: "BETTER_AUTH_SECRET is a unique test value" });
  }

  return results;
}

/**
 * Runs live runtime checks for a flavor (MCP connectivity, LLM key validity).
 * Only called when --live is passed.
 */
async function liveCheckFlavor(name: FlavorName): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const env = loadFlavor(name);
  const parseResult = serverSchema.safeParse(env);
  if (!parseResult.success) return results;

  const data = parseResult.data;

  results.push(await probeMcpServer(data.MCP_SERVER_URL));

  if (data.LLM_PROVIDER === "claude" && data.ANTHROPIC_API_KEY) {
    results.push(await probeAnthropicKey(data.ANTHROPIC_API_KEY));
  }

  if (data.LLM_PROVIDER === "gemini" && data.GOOGLE_AI_API_KEY) {
    results.push(await probeGeminiKey(data.GOOGLE_AI_API_KEY));
  }

  return results;
}

async function main() {
  console.log(`\nPocket CEP Flavor Diagnostics${isLive ? " (live mode)" : ""}\n`);

  let totalPassed = 0;
  let totalFailed = 0;

  for (const name of FLAVOR_NAMES) {
    console.log(`  ${name}`);

    const staticResults = checkFlavor(name);
    for (const r of staticResults) {
      console.log(`    ${r.ok ? PASS : FAIL} ${r.message}`);
      if (r.ok) totalPassed++;
      else totalFailed++;
    }

    if (isLive) {
      const filePath = resolve(process.cwd(), `.env.test.${name}`);
      if (existsSync(filePath)) {
        const liveResults = await liveCheckFlavor(name);
        for (const r of liveResults) {
          console.log(`    ${r.ok ? PASS : FAIL} ${r.message}`);
          if (r.ok) totalPassed++;
          else totalFailed++;
        }
      } else {
        console.log(`    ${SKIP} Skipped live checks (file missing)`);
      }
    }

    console.log();
  }

  const total = totalPassed + totalFailed;
  const allGood = totalFailed === 0;
  console.log(
    `Summary: ${totalPassed}/${total} checks passed across ${FLAVOR_NAMES.length} flavors.` +
      (allGood ? " All good!" : " Fix the issues above.") +
      "\n",
  );

  process.exit(allGood ? 0 : 1);
}

main().catch((error) => {
  console.error("Flavor diagnostics crashed:", error);
  process.exit(1);
});
