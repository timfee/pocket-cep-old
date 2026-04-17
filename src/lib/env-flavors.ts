/**
 * @file Utility for loading named environment "flavors" from .env.test.* files.
 *
 * Each flavor represents a specific configuration combo (e.g. Claude +
 * service_account, Gemini + user_oauth). This module parses a flavor file
 * into a plain object suitable for passing to Zod's serverSchema.safeParse().
 *
 * Used by:
 *   - The flavor integration test suite to validate each combo
 *   - The doctor:flavors script to probe each configuration
 *
 * Extension point: add a new .env.test.{name} file and include the name
 * in FLAVOR_NAMES below to automatically include it in all harnesses.
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { LOG_TAGS } from "./constants";

/**
 * All available flavor names. Each corresponds to a .env.test.{name} file
 * in the project root. The naming convention encodes both axes:
 * `{llm_provider}-{auth_mode}`. Adding a name here automatically includes
 * it in doctor:flavors and the integration test matrix.
 */
export const FLAVOR_NAMES = ["claude-sa", "claude-oauth", "gemini-sa", "gemini-oauth"] as const;

export type FlavorName = (typeof FLAVOR_NAMES)[number];

/**
 * Parses a .env-style file into a key-value object. Handles comments,
 * blank lines, and simple KEY=VALUE syntax. Does not support multiline
 * values, variable expansion, or quoting (keep test flavors simple).
 *
 * This is intentionally simpler than dotenv — flavor files should stay
 * trivial so the parsing is predictable in tests and diagnostics.
 */
export function parseEnvFile(filePath: string): Record<string, string> {
  const content = readFileSync(filePath, "utf-8");
  const env: Record<string, string> = {};

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    env[key] = value;
  }

  return env;
}

/**
 * Loads a named flavor's env vars from its .env.test.{name} file.
 * Throws if the file doesn't exist — this is a developer setup error,
 * not a runtime condition, so failing fast is appropriate.
 */
export function loadFlavor(name: FlavorName): Record<string, string> {
  const filePath = resolve(process.cwd(), `.env.test.${name}`);

  if (!existsSync(filePath)) {
    throw new Error(
      `Flavor file not found: .env.test.${name}\n` +
        `Expected at: ${filePath}\n` +
        `Run the setup instructions in the README to create flavor files.`,
    );
  }

  return parseEnvFile(filePath);
}

/**
 * Loads all flavors and returns them as a map of name -> env object.
 * Unlike loadFlavor(), this is lenient — it skips missing files with a
 * warning. Used by diagnostic scripts that should report all available
 * flavors without aborting on the first missing one.
 */
export function loadAllFlavors(): Map<FlavorName, Record<string, string>> {
  const flavors = new Map<FlavorName, Record<string, string>>();

  for (const name of FLAVOR_NAMES) {
    const filePath = resolve(process.cwd(), `.env.test.${name}`);
    if (!existsSync(filePath)) {
      console.warn(LOG_TAGS.FLAVORS, `Skipping missing flavor: .env.test.${name}`);
      continue;
    }
    flavors.set(name, parseEnvFile(filePath));
  }

  return flavors;
}
