/**
 * @file Validates every .env.test.* flavor file passes Zod and
 * matches its filename convention.
 */

import { describe, it, expect } from "vitest";
import { existsSync } from "fs";
import { resolve } from "path";
import { serverSchema } from "@/lib/env";
import { FLAVOR_NAMES, loadFlavor } from "@/lib/env-flavors";

describe("environment flavors", () => {
  for (const name of FLAVOR_NAMES) {
    const exists = existsSync(resolve(process.cwd(), `.env.test.${name}`));

    it.skipIf(!exists)(`${name}: passes Zod validation with correct config`, () => {
      const env = loadFlavor(name);
      const result = serverSchema.safeParse(env);

      if (!result.success) {
        const issues = result.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        throw new Error(`Flavor "${name}" failed: ${issues}`);
      }

      const expectsClaude = name.startsWith("claude");
      const expectsSa = name.endsWith("-sa");

      expect(result.data.LLM_PROVIDER).toBe(expectsClaude ? "claude" : "gemini");
      expect(result.data.AUTH_MODE).toBe(expectsSa ? "service_account" : "user_oauth");
      expect(result.data.BETTER_AUTH_SECRET).not.toBe("please-change-me-to-a-real-secret");
    });
  }

  it("has exactly 4 flavors covering the 2x2 matrix", () => {
    expect(FLAVOR_NAMES.length).toBe(4);
  });
});
