# Auth Error Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop swallowing Google ADC auth failures silently. Detect them once, surface them everywhere (chat card, user selector, global banner, `doctor`) with the remedy the user actually needs (`gcloud auth login`).

**Architecture:** One typed `AuthError` + classifier (`toAuthError`). Fail-loud: `getADCToken()` throws instead of returning `null`; API routes return a structured 401; MCP tool wrapper converts tool-error strings to thrown `AuthError`. Client surfaces listen on a `CustomEvent` bus dispatched by `authAwareFetch` and the chat-message component; a sticky `AuthBanner` renders in the root layout and clears only after a successful `/api/auth/health` probe.

**Tech Stack:** Next.js 16 App Router, React 19, Vitest (node env), AI SDK v6, `@modelcontextprotocol/sdk`, `google-auth-library`, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-04-17-auth-error-handling-design.md`

---

## File Structure

**New files**

- `src/lib/auth-errors.ts` — `AuthError` class + `toAuthError()` classifier + `isAuthError()` guard.
- `src/lib/adc.ts` — owns `getADCToken()` and `getQuotaProject()`, extracted from `admin-sdk.ts` so the health route can reuse them without pulling in directory search.
- `src/lib/auth-aware-fetch.ts` — small `fetch` wrapper that parses 401 auth-error payloads and dispatches `CustomEvent("auth-error")` on `window`.
- `src/app/api/auth/health/route.ts` — `GET` that calls `getADCToken()` and returns `{ ok: true }` or 401 with the structured payload.
- `src/components/auth-health-provider.tsx` — React context + window-event listener holding the current `AuthErrorPayload | null`.
- `src/components/auth-banner.tsx` — amber sticky banner that renders when the provider holds an error.
- `src/__tests__/unit/auth-errors.test.ts`
- `src/__tests__/unit/adc.test.ts`
- `src/__tests__/unit/mcp-tools.test.ts`
- `src/__tests__/integration/api/users-route.test.ts`
- `src/__tests__/integration/api/users-activity-route.test.ts`
- `src/__tests__/integration/api/auth-health-route.test.ts`

**Modified files**

- `src/lib/admin-sdk.ts` — import `getADCToken` from `adc.ts`; `searchUsers()` lets `AuthError` propagate.
- `src/lib/mcp-tools.ts` — tool `execute()` wrapper converts MCP tool errors into thrown `AuthError`.
- `src/lib/doctor-checks.ts` — new `probeAdcToken()` helper.
- `src/lib/doctor.ts` — runs ADC probe in the Runtime section.
- `src/app/api/users/route.ts` — catches `AuthError` → 401 JSON.
- `src/app/api/users/activity/route.ts` — removes the "degrade silently" catch; rethrows auth errors → 401.
- `src/app/api/chat/route.ts` — returns 401 JSON when `AuthError` is thrown before streaming starts.
- `src/app/layout.tsx` — wraps children with `AuthHealthProvider`, renders `AuthBanner`.
- `src/components/user-selector.tsx` — switches to `authAwareFetch`; reads structured payload instead of string-matching.
- `src/components/chat-message.tsx` — special-cases `output-error` whose `errorText` is an `AuthErrorPayload`; dispatches the same `CustomEvent` so the banner lights up.
- `README.md`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` — short "ADC session expired" section + `AuthError` contract note.

---

## Task 1: Typed auth-error module (foundation)

**Files:**
- Create: `src/lib/auth-errors.ts`
- Test: `src/__tests__/unit/auth-errors.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/unit/auth-errors.test.ts`:

```typescript
/**
 * @file Tests for typed auth-error classification.
 *
 * Verifies that every shape of Google auth failure we've observed in the
 * wild — OAuth JSON bodies, gaxios errors, plain string messages, MCP
 * tool-error strings — collapses to a single AuthError with the right code
 * and remedy. Non-auth errors must return null so callers can rethrow.
 */

import { describe, it, expect } from "vitest";
import { toAuthError, isAuthError, AuthError } from "@/lib/auth-errors";

describe("toAuthError", () => {
  it("classifies a Google OAuth invalid_rapt JSON body", () => {
    const err = {
      error: "invalid_grant",
      error_description: "reauth related error (invalid_rapt)",
      error_uri: "https://support.google.com/a/answer/9368756",
      error_subtype: "invalid_rapt",
    };
    const result = toAuthError(err, "adc");
    expect(result).toBeInstanceOf(AuthError);
    expect(result?.code).toBe("invalid_rapt");
    expect(result?.source).toBe("adc");
    expect(result?.command).toBe("gcloud auth login");
    expect(result?.docsUrl).toBe("https://support.google.com/a/answer/9368756");
  });

  it("classifies a plain invalid_grant JSON body without subtype", () => {
    const err = {
      error: "invalid_grant",
      error_description: "Bad Request",
    };
    const result = toAuthError(err, "adc");
    expect(result?.code).toBe("invalid_grant");
    expect(result?.command).toBe("gcloud auth login");
  });

  it("classifies a gaxios-shaped error with nested response.data", () => {
    const err = {
      message: "invalid_grant",
      response: {
        data: {
          error: "invalid_grant",
          error_subtype: "invalid_rapt",
        },
      },
    };
    const result = toAuthError(err, "admin-sdk");
    expect(result?.code).toBe("invalid_rapt");
    expect(result?.source).toBe("admin-sdk");
  });

  it("classifies an MCP tool-error string mentioning invalid_rapt", () => {
    const raw = "API Error: invalid_grant - reauth related error (invalid_rapt)";
    const result = toAuthError(raw, "mcp-tool");
    expect(result?.code).toBe("invalid_rapt");
    expect(result?.source).toBe("mcp-tool");
  });

  it("classifies an MCP tool-error string with only invalid_grant", () => {
    const raw = "API Error: invalid_grant - token expired";
    const result = toAuthError(raw, "mcp-tool");
    expect(result?.code).toBe("invalid_grant");
  });

  it("classifies a generic UNAUTHENTICATED string as unauthenticated", () => {
    const err = new Error("Request had invalid authentication credentials. UNAUTHENTICATED");
    const result = toAuthError(err, "admin-sdk");
    expect(result?.code).toBe("unauthenticated");
  });

  it("classifies a 'no ADC' / 'Could not load default credentials' error", () => {
    const err = new Error(
      "Could not load the default credentials. Browse to https://developers.google.com/accounts/docs/application-default-credentials",
    );
    const result = toAuthError(err, "adc");
    expect(result?.code).toBe("no_adc");
    expect(result?.command).toBe("gcloud auth application-default login");
  });

  it("returns null for unrelated errors", () => {
    expect(toAuthError(new TypeError("bad"), "adc")).toBeNull();
    expect(toAuthError("network blip", "mcp-tool")).toBeNull();
    expect(toAuthError(null, "adc")).toBeNull();
    expect(toAuthError(undefined, "adc")).toBeNull();
    expect(toAuthError({ foo: "bar" }, "adc")).toBeNull();
  });

  it("AuthError serializes to the wire payload via toPayload()", () => {
    const err = toAuthError(
      { error: "invalid_grant", error_subtype: "invalid_rapt" },
      "adc",
    )!;
    const payload = err.toPayload();
    expect(payload).toEqual({
      code: "invalid_rapt",
      source: "adc",
      message: expect.any(String),
      remedy: expect.any(String),
      command: "gcloud auth login",
      docsUrl: undefined,
    });
  });
});

describe("isAuthError", () => {
  it("narrows AuthError instances", () => {
    const err = new AuthError({
      code: "invalid_grant",
      source: "adc",
      message: "m",
      remedy: "r",
    });
    expect(isAuthError(err)).toBe(true);
    expect(isAuthError(new Error("plain"))).toBe(false);
    expect(isAuthError("string")).toBe(false);
    expect(isAuthError(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- auth-errors`
Expected: FAIL — `Cannot find module '@/lib/auth-errors'`

- [ ] **Step 3: Implement the module**

Create `src/lib/auth-errors.ts`:

```typescript
/**
 * @file Typed auth-error classification for ADC / Admin SDK / MCP tool failures.
 *
 * One `toAuthError()` classifier for every surface. It turns whatever Google
 * happens to throw (OAuth JSON, gaxios error, plain string, or an MCP
 * tool-error message) into a single `AuthError` with a user-facing remedy.
 * Callers that don't want to hard-code error strings can rely on this type
 * and stop duplicating substring checks across the codebase.
 */

/**
 * Discriminated auth-error codes. `unknown_auth` is a deliberate escape
 * hatch — we'd rather surface a generic "re-authenticate" nudge than miss
 * a classification entirely.
 */
export type AuthErrorCode =
  | "invalid_rapt"
  | "invalid_grant"
  | "no_adc"
  | "unauthenticated"
  | "unknown_auth";

/**
 * Wire shape every surface consumes: API 401 bodies, banner state, and
 * chat tool-error cards all serialize to this.
 */
export interface AuthErrorPayload {
  code: AuthErrorCode;
  source: "adc" | "mcp-tool" | "admin-sdk";
  message: string;
  remedy: string;
  command?: string;
  docsUrl?: string;
}

/**
 * Error class that carries an `AuthErrorPayload`. Throwing this from a
 * server call is how we signal "auth failed, here is the remedy" without
 * every caller re-matching strings.
 */
export class AuthError extends Error implements AuthErrorPayload {
  readonly code: AuthErrorCode;
  readonly source: AuthErrorPayload["source"];
  readonly remedy: string;
  readonly command?: string;
  readonly docsUrl?: string;
  /**
   * Human-readable summary. Stored separately because `this.message` is
   * overridden to the JSON-serialized payload so the AI SDK's
   * output-error state carries the structured data through to the chat UI.
   */
  readonly displayMessage: string;

  constructor(payload: AuthErrorPayload) {
    super(JSON.stringify(payload));
    this.name = "AuthError";
    this.displayMessage = payload.message;
    this.code = payload.code;
    this.source = payload.source;
    this.remedy = payload.remedy;
    this.command = payload.command;
    this.docsUrl = payload.docsUrl;
  }

  toPayload(): AuthErrorPayload {
    return {
      code: this.code,
      source: this.source,
      message: this.displayMessage,
      remedy: this.remedy,
      command: this.command,
      docsUrl: this.docsUrl,
    };
  }
}

/**
 * Type guard. Survives structured-clone and cross-realm issues by also
 * accepting `name === "AuthError"` shapes — useful when the error has
 * been re-thrown across async boundaries.
 */
export function isAuthError(err: unknown): err is AuthError {
  return (
    err instanceof AuthError ||
    (typeof err === "object" &&
      err !== null &&
      (err as { name?: string }).name === "AuthError")
  );
}

type GoogleOAuthBody = {
  error?: string;
  error_description?: string;
  error_uri?: string;
  error_subtype?: string;
};

function asOAuthBody(value: unknown): GoogleOAuthBody | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as GoogleOAuthBody;
  if (typeof candidate.error !== "string") return null;
  return candidate;
}

function extractOAuthBody(err: unknown): GoogleOAuthBody | null {
  const direct = asOAuthBody(err);
  if (direct) return direct;
  if (err && typeof err === "object") {
    const nested = (err as { response?: { data?: unknown } }).response?.data;
    const fromResponse = asOAuthBody(nested);
    if (fromResponse) return fromResponse;
  }
  return null;
}

function extractMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return "";
}

function buildPayload(
  code: AuthErrorCode,
  source: AuthErrorPayload["source"],
  docsUrl?: string,
): AuthErrorPayload {
  switch (code) {
    case "invalid_rapt":
      return {
        code,
        source,
        message: "Google requires you to re-authenticate.",
        remedy: "Run `gcloud auth login` and retry.",
        command: "gcloud auth login",
        docsUrl,
      };
    case "invalid_grant":
      return {
        code,
        source,
        message: "Your Google credentials are no longer valid.",
        remedy: "Run `gcloud auth login` to refresh them.",
        command: "gcloud auth login",
        docsUrl,
      };
    case "no_adc":
      return {
        code,
        source,
        message: "Google Application Default Credentials aren't configured.",
        remedy: "Run `gcloud auth application-default login` to set them up.",
        command: "gcloud auth application-default login",
        docsUrl,
      };
    case "unauthenticated":
      return {
        code,
        source,
        message: "Google rejected the request (UNAUTHENTICATED).",
        remedy: "Run `gcloud auth login` and confirm your account has access.",
        command: "gcloud auth login",
        docsUrl,
      };
    case "unknown_auth":
      return {
        code,
        source,
        message: "An authentication error occurred.",
        remedy: "Try re-running `gcloud auth login` and retry.",
        command: "gcloud auth login",
        docsUrl,
      };
  }
}

/**
 * Classifies an arbitrary error as an `AuthError` when possible. Returns
 * null if the error isn't auth-related so callers can rethrow untouched.
 *
 * Recognised inputs:
 *   - Google OAuth JSON body (direct or nested under `response.data`)
 *   - `Error` / string messages containing `invalid_rapt`, `invalid_grant`,
 *     `UNAUTHENTICATED`, or the "Could not load the default credentials" phrase
 *   - MCP tool-error strings like "API Error: invalid_grant - ..."
 */
export function toAuthError(
  err: unknown,
  source: AuthErrorPayload["source"],
): AuthError | null {
  const body = extractOAuthBody(err);
  if (body) {
    const docsUrl = body.error_uri;
    if (body.error_subtype === "invalid_rapt") {
      return new AuthError(buildPayload("invalid_rapt", source, docsUrl));
    }
    if (body.error === "invalid_grant") {
      return new AuthError(buildPayload("invalid_grant", source, docsUrl));
    }
    if (body.error === "unauthorized_client" || body.error === "access_denied") {
      return new AuthError(buildPayload("unauthenticated", source, docsUrl));
    }
  }

  const message = extractMessage(err);
  if (!message) return null;

  if (/invalid_rapt/i.test(message)) {
    return new AuthError(buildPayload("invalid_rapt", source));
  }
  if (/invalid_grant/i.test(message)) {
    return new AuthError(buildPayload("invalid_grant", source));
  }
  if (/Could not load the default credentials|application[- ]default[- ]credentials/i.test(message)) {
    return new AuthError(buildPayload("no_adc", source));
  }
  if (/UNAUTHENTICATED|401|unauthorized/i.test(message)) {
    return new AuthError(buildPayload("unauthenticated", source));
  }

  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- auth-errors`
Expected: PASS — all cases green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth-errors.ts src/__tests__/unit/auth-errors.test.ts
git commit -m "Add typed AuthError module and classifier"
```

---

## Task 2: Extract ADC token helper into its own module

**Files:**
- Create: `src/lib/adc.ts`
- Modify: `src/lib/admin-sdk.ts`
- Test: `src/__tests__/unit/adc.test.ts`

We split `getADCToken()` out of `admin-sdk.ts` so the new `/api/auth/health` route can probe ADC without pulling in directory-search code, and so `adc.ts` is the single module that imports `google-auth-library`.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/unit/adc.test.ts`:

```typescript
/**
 * @file Unit tests for the ADC token helper.
 *
 * Mocks google-auth-library so we can force refresh-token failures and
 * verify that `getADCToken()` throws AuthError with the right code
 * instead of the previous silent-null behavior.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetAccessToken = vi.fn();
const mockGetClient = vi.fn();

vi.mock("google-auth-library", () => ({
  GoogleAuth: vi.fn(function GoogleAuth() {
    return { getClient: mockGetClient };
  }),
}));

import { getADCToken } from "@/lib/adc";
import { AuthError, isAuthError } from "@/lib/auth-errors";

describe("getADCToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetClient.mockResolvedValue({ getAccessToken: mockGetAccessToken });
  });

  it("returns the token string on success", async () => {
    mockGetAccessToken.mockResolvedValue({ token: "ya29.abc" });
    const token = await getADCToken();
    expect(token).toBe("ya29.abc");
  });

  it("throws AuthError(invalid_rapt) when refresh reports invalid_rapt", async () => {
    mockGetAccessToken.mockRejectedValue({
      message: "invalid_grant",
      response: {
        data: {
          error: "invalid_grant",
          error_subtype: "invalid_rapt",
          error_uri: "https://support.google.com/a/answer/9368756",
        },
      },
    });

    await expect(getADCToken()).rejects.toSatisfy((err: unknown) => {
      return isAuthError(err) && (err as AuthError).code === "invalid_rapt";
    });
  });

  it("throws AuthError(no_adc) when ADC is not configured", async () => {
    mockGetClient.mockRejectedValue(
      new Error("Could not load the default credentials. Browse to ..."),
    );

    await expect(getADCToken()).rejects.toSatisfy((err: unknown) => {
      return isAuthError(err) && (err as AuthError).code === "no_adc";
    });
  });

  it("rethrows non-auth errors untouched", async () => {
    const boom = new TypeError("unrelated failure");
    mockGetAccessToken.mockRejectedValue(boom);

    await expect(getADCToken()).rejects.toBe(boom);
  });

  it("throws AuthError(unknown_auth) when the token is empty", async () => {
    mockGetAccessToken.mockResolvedValue({ token: null });

    await expect(getADCToken()).rejects.toSatisfy((err: unknown) => {
      return isAuthError(err) && (err as AuthError).code === "unknown_auth";
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- adc`
Expected: FAIL — `Cannot find module '@/lib/adc'`.

- [ ] **Step 3: Create `src/lib/adc.ts` with the helpers**

Create `src/lib/adc.ts`:

```typescript
/**
 * @file Google Application Default Credentials helpers.
 *
 * Owns every call to `google-auth-library` so the rest of the app can
 * depend on a typed AuthError contract instead of OAuth error shapes.
 * Extracted out of `admin-sdk.ts` so the health probe and doctor can
 * reuse it without pulling in directory-search code.
 */

import { LOG_TAGS } from "./constants";
import { AuthError, toAuthError } from "./auth-errors";

/**
 * Fetches an access token from Application Default Credentials.
 *
 * Throws `AuthError` on any auth-related failure (invalid_rapt,
 * invalid_grant, missing ADC, UNAUTHENTICATED). Non-auth failures are
 * rethrown untouched so upstream code can surface them verbatim.
 */
export async function getADCToken(): Promise<string> {
  try {
    const { GoogleAuth } = await import("google-auth-library");
    const auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/admin.directory.user.readonly"],
    });
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();

    if (!tokenResponse?.token) {
      throw new AuthError({
        code: "unknown_auth",
        source: "adc",
        message: "ADC returned no access token.",
        remedy: "Run `gcloud auth application-default login` to configure credentials.",
        command: "gcloud auth application-default login",
      });
    }

    return tokenResponse.token;
  } catch (error) {
    const classified = toAuthError(error, "adc");
    if (classified) {
      console.error(LOG_TAGS.AUTH, `ADC token fetch failed: ${classified.code} — ${classified.remedy}`);
      throw classified;
    }
    throw error;
  }
}

/**
 * Reads the quota_project_id from the ADC credentials file. Falls back
 * to GOOGLE_CLOUD_QUOTA_PROJECT. Returns null if neither is set — that
 * is a soft failure, not an auth failure.
 */
export async function getQuotaProject(): Promise<string | null> {
  if (process.env.GOOGLE_CLOUD_QUOTA_PROJECT) {
    return process.env.GOOGLE_CLOUD_QUOTA_PROJECT;
  }

  try {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const { homedir } = await import("os");
    const credPath = join(homedir(), ".config", "gcloud", "application_default_credentials.json");
    const creds = JSON.parse(readFileSync(credPath, "utf-8"));
    return creds.quota_project_id ?? null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Remove the old helpers from `admin-sdk.ts` and import from `adc.ts`**

Edit `src/lib/admin-sdk.ts`:

1. Add imports at the top, after the existing `errors`/`constants` imports:

```typescript
import { getADCToken, getQuotaProject } from "./adc";
import { isAuthError } from "./auth-errors";
```

2. Replace the whole `searchUsers` body so it no longer checks for null tokens and lets `AuthError` propagate. The full function should be:

```typescript
/**
 * Searches the Google Workspace user directory via the Admin SDK REST API.
 *
 * Throws `AuthError` on credential failure so API routes can return a
 * structured 401. Non-auth failures return an empty array (existing
 * behavior) — they're logged but treated as "no results".
 *
 * Supports Admin SDK query syntax:
 *   - "email:alice*" for email prefix
 *   - Plain text for general name/email search
 *   - Empty string returns the first page of all users
 */
export async function searchUsers(
  query: string,
  accessToken?: string,
  maxResults = 20,
): Promise<DirectoryUser[]> {
  const params = new URLSearchParams({
    customer: "my_customer",
    maxResults: String(maxResults),
    orderBy: "email",
    projection: "basic",
  });

  if (query) {
    params.set("query", query);
  }

  const url = `https://admin.googleapis.com/admin/directory/v1/users?${params}`;
  const token = accessToken ?? (await getADCToken());

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };

    /**
     * Quota project header is only needed for ADC — user OAuth tokens
     * carry their own project context. Reads from the ADC credentials
     * file or GOOGLE_CLOUD_QUOTA_PROJECT env var.
     */
    if (!accessToken) {
      const quotaProject = await getQuotaProject();
      if (quotaProject) {
        headers["x-goog-user-project"] = quotaProject;
      }
    }

    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error(LOG_TAGS.USERS, `Admin SDK users.list failed (${response.status}):`, body);
      return [];
    }

    const data = (await response.json()) as {
      users?: Array<{
        primaryEmail?: string;
        name?: { fullName?: string };
        thumbnailPhotoUrl?: string;
        orgUnitPath?: string;
        isAdmin?: boolean;
        suspended?: boolean;
      }>;
    };

    return (data.users ?? []).map((u) => ({
      email: u.primaryEmail ?? "",
      name: u.name?.fullName ?? "",
      photoUrl: u.thumbnailPhotoUrl,
      orgUnitPath: u.orgUnitPath,
      isAdmin: u.isAdmin,
      suspended: u.suspended,
    }));
  } catch (error) {
    if (isAuthError(error)) throw error;
    console.error(LOG_TAGS.USERS, "Admin SDK search failed:", getErrorMessage(error));
    return [];
  }
}
```

3. Delete the old `async function getADCToken()` and `async function getQuotaProject()` at the bottom of `admin-sdk.ts`. The file should end after `searchUsers`.

- [ ] **Step 5: Run tests — new adc tests and existing admin-sdk tests**

Run: `npm run test:unit -- adc admin-sdk`
Expected: PASS on both. The existing `buildAdminQuery` tests must still pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/adc.ts src/lib/admin-sdk.ts src/__tests__/unit/adc.test.ts
git commit -m "Extract ADC helpers; throw AuthError instead of returning null"
```

---

## Task 3: /api/users returns structured 401 on auth failure

**Files:**
- Modify: `src/app/api/users/route.ts`
- Test: `src/__tests__/integration/api/users-route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/integration/api/users-route.test.ts`:

```typescript
/**
 * @file Integration test for GET /api/users.
 *
 * Verifies the happy path (200 with users) and the auth-failure path
 * (401 with a structured AuthError payload). Mocks BetterAuth and the
 * Admin SDK search so we can exercise the route handler directly.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockGetSession = vi.fn();
const mockSearchUsers = vi.fn();
const mockGetGoogleAccessToken = vi.fn();

vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { getSession: mockGetSession } }),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("@/lib/access-token", () => ({
  getGoogleAccessToken: mockGetGoogleAccessToken,
}));

vi.mock("@/lib/admin-sdk", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin-sdk")>("@/lib/admin-sdk");
  return { ...actual, searchUsers: mockSearchUsers };
});

import { GET } from "@/app/api/users/route";
import { AuthError } from "@/lib/auth-errors";

describe("GET /api/users", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({ user: { id: "u1" } });
    mockGetGoogleAccessToken.mockResolvedValue(undefined);
  });

  function buildRequest(q = ""): NextRequest {
    const url = q ? `http://localhost/api/users?q=${encodeURIComponent(q)}` : "http://localhost/api/users";
    return new NextRequest(url);
  }

  it("returns 200 with users on success", async () => {
    mockSearchUsers.mockResolvedValue([
      { email: "a@x.test", name: "Alice" },
    ]);

    const res = await GET(buildRequest(""));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.users).toHaveLength(1);
    expect(body.users[0].email).toBe("a@x.test");
  });

  it("returns 401 with AuthErrorPayload when searchUsers throws AuthError", async () => {
    mockSearchUsers.mockRejectedValue(
      new AuthError({
        code: "invalid_rapt",
        source: "adc",
        message: "Google requires you to re-authenticate.",
        remedy: "Run `gcloud auth login` and retry.",
        command: "gcloud auth login",
      }),
    );

    const res = await GET(buildRequest(""));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toEqual({
      code: "invalid_rapt",
      source: "adc",
      message: "Google requires you to re-authenticate.",
      remedy: "Run `gcloud auth login` and retry.",
      command: "gcloud auth login",
      docsUrl: undefined,
    });
  });

  it("returns 500 on non-auth errors", async () => {
    mockSearchUsers.mockRejectedValue(new Error("kaboom"));

    const res = await GET(buildRequest(""));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("kaboom");
  });

  it("returns 401 when no session exists", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await GET(buildRequest(""));
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:integration -- users-route`
Expected: FAIL — the route doesn't return the new 401 payload shape (current code never throws; `searchUsers` still returns `[]` internally when auth-fails in the old path — and the current route has no try/catch).

- [ ] **Step 3: Update the route handler**

Replace the body of `src/app/api/users/route.ts` below the imports with:

```typescript
/**
 * @file Server-side user search via Google Admin SDK Directory API.
 *
 * GET /api/users?q=alice → searches users by email/name
 * GET /api/users         → returns first 20 users
 *
 * Auth failures return HTTP 401 with an AuthErrorPayload so the client
 * can render an actionable remedy instead of silently showing an empty
 * dropdown.
 */

import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { getGoogleAccessToken } from "@/lib/access-token";
import { searchUsers, buildAdminQuery, type DirectoryUser } from "@/lib/admin-sdk";
import { isAuthError } from "@/lib/auth-errors";
import { getErrorMessage } from "@/lib/errors";

export type { DirectoryUser };

/**
 * Searches the org's user directory. The optional `q` query parameter
 * is passed to the Admin SDK as a server-side filter.
 */
export async function GET(request: NextRequest) {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const query = request.nextUrl.searchParams.get("q") ?? "";
  const accessToken = await getGoogleAccessToken();
  const adminQuery = buildAdminQuery(query);

  try {
    const users = await searchUsers(adminQuery, accessToken);
    return NextResponse.json({ users });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json({ error: error.toPayload() }, { status: 401 });
    }
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:integration -- users-route`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/users/route.ts src/__tests__/integration/api/users-route.test.ts
git commit -m "Return structured 401 AuthError payload from /api/users"
```

---

## Task 4: /api/users/activity stops degrading silently

**Files:**
- Modify: `src/app/api/users/activity/route.ts`
- Test: `src/__tests__/integration/api/users-activity-route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/integration/api/users-activity-route.test.ts`:

```typescript
/**
 * @file Integration test for GET /api/users/activity.
 *
 * Verifies the activity route (a) returns the grouped activity map on
 * success and (b) returns 401 with an AuthErrorPayload on auth failure
 * — no more silent 200-with-empty-map degradation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetSession = vi.fn();
const mockCallMcpTool = vi.fn();
const mockGetGoogleAccessToken = vi.fn();
const mockGetEnv = vi.fn();

vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { getSession: mockGetSession } }),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("@/lib/access-token", () => ({
  getGoogleAccessToken: mockGetGoogleAccessToken,
}));

vi.mock("@/lib/env", () => ({
  getEnv: mockGetEnv,
}));

vi.mock("@/lib/mcp-client", () => ({
  callMcpTool: mockCallMcpTool,
}));

import { GET } from "@/app/api/users/activity/route";
import { AuthError } from "@/lib/auth-errors";

describe("GET /api/users/activity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({ user: { id: "u1" } });
    mockGetEnv.mockReturnValue({ MCP_SERVER_URL: "http://localhost:4000/mcp" });
    // Unique per test to bypass the in-process cache.
    mockGetGoogleAccessToken.mockResolvedValue(`token-${Math.random()}`);
  });

  it("returns grouped activity on success", async () => {
    mockCallMcpTool.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            activities: [
              { actor: { email: "a@x.test" }, id: { time: "2026-04-16T00:00:00Z" } },
            ],
          }),
        },
      ],
      isError: false,
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activity["a@x.test"].eventCount).toBe(1);
  });

  it("returns 401 with AuthErrorPayload when MCP call throws AuthError", async () => {
    mockCallMcpTool.mockRejectedValue(
      new AuthError({
        code: "invalid_rapt",
        source: "mcp-tool",
        message: "Google requires you to re-authenticate.",
        remedy: "Run `gcloud auth login` and retry.",
        command: "gcloud auth login",
      }),
    );

    const res = await GET();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_rapt");
    expect(body.error.source).toBe("mcp-tool");
  });

  it("returns 200 with empty activity when MCP throws a non-auth error", async () => {
    mockCallMcpTool.mockRejectedValue(new Error("random MCP error"));

    const res = await GET();
    // Non-auth failures are still tolerable for this nice-to-have surface.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activity).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:integration -- users-activity-route`
Expected: FAIL — current route returns 200 with `{activity: {}}` for auth errors too.

- [ ] **Step 3: Update the route handler**

Edit `src/app/api/users/activity/route.ts`. Replace the `try`/`catch` block (lines 58-79) with:

```typescript
  try {
    const result = await callMcpTool(
      config.MCP_SERVER_URL,
      "get_chrome_activity_log",
      { userKey: "all", maxResults: ACTIVITY_MAX_EVENTS },
      accessToken,
    );

    const activities = extractActivities(result.content);
    const grouped = groupByUser(activities);
    activityCache.set(key, { data: grouped, expiresAt: now + ACTIVITY_TTL_MS });
    return NextResponse.json({ activity: grouped });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json({ error: error.toPayload() }, { status: 401 });
    }

    /**
     * Non-auth failures (quota, transient 5xx) fall through to an empty
     * activity map — activity is a nice-to-have and the selector works
     * without it. Auth errors never take this path; they surface above.
     */
    console.log(LOG_TAGS.MCP, "Activity fetch failed:", getErrorMessage(error));
    return NextResponse.json({ activity: {} });
  }
```

Add the import at the top of the file (next to the existing imports from `@/lib/mcp-client`):

```typescript
import { isAuthError } from "@/lib/auth-errors";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:integration -- users-activity-route`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/users/activity/route.ts src/__tests__/integration/api/users-activity-route.test.ts
git commit -m "Stop swallowing auth errors on /api/users/activity"
```

---

## Task 5: /api/auth/health probe endpoint

**Files:**
- Create: `src/app/api/auth/health/route.ts`
- Test: `src/__tests__/integration/api/auth-health-route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/integration/api/auth-health-route.test.ts`:

```typescript
/**
 * @file Integration test for GET /api/auth/health.
 *
 * Probes ADC credentials on demand. Used by the auth-banner "Check
 * again" button to clear the banner after the user runs gcloud auth login.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetSession = vi.fn();
const mockGetADCToken = vi.fn();

vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { getSession: mockGetSession } }),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("@/lib/adc", () => ({
  getADCToken: mockGetADCToken,
}));

import { GET } from "@/app/api/auth/health/route";
import { AuthError } from "@/lib/auth-errors";

describe("GET /api/auth/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({ user: { id: "u1" } });
  });

  it("returns 200 { ok: true } when ADC succeeds", async () => {
    mockGetADCToken.mockResolvedValue("ya29.abc");

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns 401 with AuthErrorPayload when ADC throws AuthError", async () => {
    mockGetADCToken.mockRejectedValue(
      new AuthError({
        code: "invalid_rapt",
        source: "adc",
        message: "Google requires you to re-authenticate.",
        remedy: "Run `gcloud auth login` and retry.",
        command: "gcloud auth login",
      }),
    );

    const res = await GET();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("invalid_rapt");
  });

  it("returns 401 when no session exists", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await GET();
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:integration -- auth-health-route`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route**

Create `src/app/api/auth/health/route.ts`:

```typescript
/**
 * @file Health probe for Google ADC credentials.
 *
 * GET /api/auth/health
 *   200 { ok: true }                — ADC is valid
 *   401 { ok: false, error: AuthErrorPayload } — re-auth required
 *
 * Used by the auth-banner "Check again" button to verify the user has
 * re-run `gcloud auth login`. No side effects, no cache — each call
 * exchanges the refresh token fresh.
 */

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { getADCToken } from "@/lib/adc";
import { isAuthError } from "@/lib/auth-errors";
import { getErrorMessage } from "@/lib/errors";

/**
 * Probes ADC by requesting a fresh access token. Returns 200 if Google
 * issues one and 401 with the structured payload if it refuses.
 */
export async function GET() {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  try {
    await getADCToken();
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { ok: false, error: error.toPayload() },
        { status: 401 },
      );
    }
    return NextResponse.json({ ok: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:integration -- auth-health-route`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/auth/health/route.ts src/__tests__/integration/api/auth-health-route.test.ts
git commit -m "Add /api/auth/health probe endpoint"
```

---

## Task 6: MCP tool wrapper throws AuthError on auth-shaped tool failures

**Files:**
- Modify: `src/lib/mcp-tools.ts`
- Test: `src/__tests__/unit/mcp-tools.test.ts`

The MCP server wraps Google OAuth failures into a tool result like:

```
{ isError: true, content: [{ type: "text", text: "API Error: invalid_grant - reauth related error (invalid_rapt)" }] }
```

The AI SDK's `execute()` will swallow that into a normal string output, which means the chat renders it as a plain tool response instead of the `output-error` state. We need to *throw* on auth-shaped tool errors so the tool part gets `state: 'output-error'` with the structured payload in `errorText`.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/unit/mcp-tools.test.ts`:

```typescript
/**
 * @file Unit tests for getMcpToolsForAiSdk's execute wrapper.
 *
 * Verifies that MCP tool calls returning isError:true with an auth-shaped
 * message get re-thrown as AuthError (so the AI SDK surfaces them as
 * output-error) while non-auth errors return their content normally.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockListMcpTools = vi.fn();
const mockCallMcpTool = vi.fn();

vi.mock("@/lib/mcp-client", () => ({
  listMcpTools: mockListMcpTools,
  callMcpTool: mockCallMcpTool,
}));

import { getMcpToolsForAiSdk, invalidateToolCatalog } from "@/lib/mcp-tools";
import { isAuthError, AuthError } from "@/lib/auth-errors";

describe("getMcpToolsForAiSdk tool execute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateToolCatalog();
    mockListMcpTools.mockResolvedValue([
      {
        name: "get_chrome_activity_log",
        description: "d",
        inputSchema: { type: "object", properties: {} },
      },
    ]);
  });

  async function runExecute(result: unknown): Promise<{ thrown: unknown; output: unknown }> {
    mockCallMcpTool.mockResolvedValue(result);
    const tools = await getMcpToolsForAiSdk("http://localhost:4000/mcp", `t-${Math.random()}`);
    const tool = tools["get_chrome_activity_log"] as unknown as {
      execute: (args: Record<string, unknown>) => Promise<unknown>;
    };
    try {
      const output = await tool.execute({});
      return { thrown: null, output };
    } catch (err) {
      return { thrown: err, output: null };
    }
  }

  it("throws AuthError(invalid_rapt) when the tool returns an isError result mentioning invalid_rapt", async () => {
    const { thrown } = await runExecute({
      isError: true,
      content: [
        {
          type: "text",
          text: "API Error: invalid_grant - reauth related error (invalid_rapt)",
        },
      ],
    });
    expect(isAuthError(thrown)).toBe(true);
    expect((thrown as AuthError).code).toBe("invalid_rapt");
    expect((thrown as AuthError).source).toBe("mcp-tool");
  });

  it("throws AuthError(invalid_grant) for a plain invalid_grant tool error", async () => {
    const { thrown } = await runExecute({
      isError: true,
      content: [{ type: "text", text: "API Error: invalid_grant - token expired" }],
    });
    expect(isAuthError(thrown)).toBe(true);
    expect((thrown as AuthError).code).toBe("invalid_grant");
  });

  it("returns content normally for isError:false results", async () => {
    const { thrown, output } = await runExecute({
      isError: false,
      content: [{ type: "text", text: "ok" }],
    });
    expect(thrown).toBeNull();
    expect(output).toEqual([{ type: "text", text: "ok" }]);
  });

  it("returns content for non-auth tool errors (caller renders error text unchanged)", async () => {
    const { thrown, output } = await runExecute({
      isError: true,
      content: [{ type: "text", text: "Rate limited. Try again in 30s." }],
    });
    expect(thrown).toBeNull();
    expect(output).toEqual([{ type: "text", text: "Rate limited. Try again in 30s." }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- mcp-tools`
Expected: FAIL — execute wrapper currently ignores `isError` and returns `result.content`.

- [ ] **Step 3: Update `src/lib/mcp-tools.ts`**

Add imports at the top, next to the existing `callMcpTool` import:

```typescript
import { toAuthError } from "./auth-errors";
```

Replace the `execute` callback inside `getMcpToolsForAiSdk` with:

```typescript
      execute: async (args) => {
        console.log(LOG_TAGS.MCP, `Tool: ${t.name}`);
        const result = await callMcpTool(
          serverUrl,
          t.name,
          args as Record<string, unknown>,
          accessToken,
        );

        /**
         * Auth-shaped tool errors get promoted to thrown AuthError so the
         * AI SDK surfaces them as `state: 'output-error'` with the
         * structured payload. Non-auth errors pass through as content so
         * the model can narrate them to the user.
         */
        if (result.isError) {
          const text = extractErrorText(result.content);
          const authErr = toAuthError(text, "mcp-tool");
          if (authErr) throw authErr;
        }

        return result.content;
      },
```

Then add the helper at the bottom of the same file:

```typescript
/**
 * Pulls the first `type: "text"` block out of an MCP tool result's
 * content array. The MCP server returns errors as text blocks, so this
 * is the only shape we need to classify against.
 */
function extractErrorText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  for (const block of content) {
    if (
      block &&
      typeof block === "object" &&
      "type" in block &&
      block.type === "text" &&
      "text" in block &&
      typeof block.text === "string"
    ) {
      return block.text;
    }
  }
  return "";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit -- mcp-tools mcp-client`
Expected: PASS on both suites (mcp-client should be unaffected).

- [ ] **Step 5: Commit**

```bash
git add src/lib/mcp-tools.ts src/__tests__/unit/mcp-tools.test.ts
git commit -m "Promote auth-shaped MCP tool errors to thrown AuthError"
```

---

## Task 7: /api/chat returns 401 payload when AuthError is thrown pre-stream

**Files:**
- Modify: `src/app/api/chat/route.ts`

Tool-call auth errors that happen mid-stream already render as `output-error` via Task 6. But if `getMcpToolsForAiSdk()` itself fails with an `AuthError` (e.g. the listTools call needs ADC and ADC is broken), the current route returns a 502 with a plain string. We want a structured 401 so `authAwareFetch` on the client fires the banner.

- [ ] **Step 1: Update the pre-stream `catch` block**

Edit `src/app/api/chat/route.ts`. Replace the existing try/catch around `getMcpToolsForAiSdk` with:

```typescript
  let tools;
  try {
    tools = await getMcpToolsForAiSdk(config.MCP_SERVER_URL, accessToken);
  } catch (error) {
    if (isAuthError(error)) {
      return new Response(JSON.stringify({ error: error.toPayload() }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: getErrorMessage(error) }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
```

Add the import at the top of the file, alongside `getErrorMessage`:

```typescript
import { isAuthError } from "@/lib/auth-errors";
```

- [ ] **Step 2: Run existing tests — nothing should break**

Run: `npm run test`
Expected: PASS on everything including the new route test files from Tasks 3-5.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/chat/route.ts
git commit -m "Return 401 AuthError payload from /api/chat when listing MCP tools fails auth"
```

---

## Task 8: authAwareFetch wrapper + client auth-event bus

**Files:**
- Create: `src/lib/auth-aware-fetch.ts`

- [ ] **Step 1: Create the wrapper**

Create `src/lib/auth-aware-fetch.ts`:

```typescript
/**
 * @file Client-side fetch wrapper that recognizes 401 AuthErrorPayload
 * responses and dispatches a window event so the global banner can react.
 *
 * Kept deliberately tiny and framework-free: it doesn't import React or
 * use hooks, so it can be called from anywhere — components, event
 * handlers, or plain helpers — without context propagation.
 *
 * The chat-message component dispatches the same event when it detects
 * an auth payload in a tool part's errorText, so the banner lights up
 * whether the auth error hit a JSON endpoint or streamed through the AI
 * SDK's tool channel.
 */

import type { AuthErrorPayload } from "./auth-errors";

/**
 * Name of the window-scoped custom event carrying an AuthErrorPayload.
 * Listeners should be attached in AuthHealthProvider.
 */
export const AUTH_ERROR_EVENT = "auth-error";

/**
 * Dispatches the auth-error event. Exposed so non-fetch callers (e.g. the
 * chat-message component when it sees an auth-shaped errorText) can light
 * up the banner using the same code path.
 */
export function reportAuthErrorGlobally(payload: AuthErrorPayload): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<AuthErrorPayload>(AUTH_ERROR_EVENT, { detail: payload }));
}

/**
 * Thin wrapper around fetch. On 401 responses whose JSON body matches
 * `{ error: AuthErrorPayload }`, dispatches the auth event and returns
 * the original response so callers can still inspect it. On all other
 * responses it behaves like plain fetch.
 */
export async function authAwareFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(input, init);
  if (response.status !== 401) return response;

  const cloned = response.clone();
  try {
    const body = (await cloned.json()) as { error?: unknown };
    if (isAuthErrorPayload(body.error)) {
      reportAuthErrorGlobally(body.error);
    }
  } catch {
    // Not JSON; not our shape. Silently pass through.
  }

  return response;
}

/**
 * Runtime check for the AuthErrorPayload wire shape. Defensive because
 * the value crosses a JSON boundary where the compile-time type is lost.
 */
function isAuthErrorPayload(value: unknown): value is AuthErrorPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as AuthErrorPayload).code === "string" &&
    typeof (value as AuthErrorPayload).source === "string" &&
    typeof (value as AuthErrorPayload).remedy === "string"
  );
}
```

- [ ] **Step 2: Commit (no dedicated tests — this is thin glue covered by downstream integration)**

```bash
git add src/lib/auth-aware-fetch.ts
git commit -m "Add authAwareFetch wrapper and reportAuthErrorGlobally helper"
```

---

## Task 9: AuthHealthProvider context

**Files:**
- Create: `src/components/auth-health-provider.tsx`

- [ ] **Step 1: Create the provider**

Create `src/components/auth-health-provider.tsx`:

```typescript
/**
 * @file Global auth-health context.
 *
 * Listens on the window for `auth-error` events dispatched by
 * authAwareFetch (JSON routes) and chat-message (streamed tool errors),
 * and exposes the current AuthErrorPayload plus a `clear()` helper to
 * consumers. The banner reads from here and calls clear() when the
 * /api/auth/health probe comes back green.
 *
 * This is the only place that owns the "currently showing an auth
 * error" state — everything else is stateless dispatch.
 */

"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { AuthErrorPayload } from "@/lib/auth-errors";
import { AUTH_ERROR_EVENT } from "@/lib/auth-aware-fetch";

/**
 * Value exposed by the AuthHealthContext. `clear()` drops the current
 * error (called on successful health probe); `report()` is available for
 * direct callers (mostly tests or non-fetch flows).
 */
type AuthHealthValue = {
  error: AuthErrorPayload | null;
  report: (payload: AuthErrorPayload) => void;
  clear: () => void;
};

const AuthHealthContext = createContext<AuthHealthValue | null>(null);

/**
 * Mounts in the root layout. Subscribes to window `auth-error` events
 * while mounted so any component in the tree (including ones that use
 * plain fetch through authAwareFetch) can light up the banner.
 */
export function AuthHealthProvider({ children }: { children: ReactNode }) {
  const [error, setError] = useState<AuthErrorPayload | null>(null);

  const report = useCallback((payload: AuthErrorPayload) => {
    setError(payload);
  }, []);

  const clear = useCallback(() => {
    setError(null);
  }, []);

  useEffect(() => {
    function handler(event: Event) {
      const detail = (event as CustomEvent<AuthErrorPayload>).detail;
      if (detail && typeof detail.code === "string") {
        setError(detail);
      }
    }
    window.addEventListener(AUTH_ERROR_EVENT, handler);
    return () => window.removeEventListener(AUTH_ERROR_EVENT, handler);
  }, []);

  return (
    <AuthHealthContext.Provider value={{ error, report, clear }}>
      {children}
    </AuthHealthContext.Provider>
  );
}

/**
 * Hook for reading auth-health state. Throws if used outside the
 * provider — surfaces wiring mistakes early.
 */
export function useAuthHealth(): AuthHealthValue {
  const ctx = useContext(AuthHealthContext);
  if (!ctx) throw new Error("useAuthHealth must be used within AuthHealthProvider");
  return ctx;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/auth-health-provider.tsx
git commit -m "Add AuthHealthProvider context and useAuthHealth hook"
```

---

## Task 10: AuthBanner component

**Files:**
- Create: `src/components/auth-banner.tsx`

- [ ] **Step 1: Create the banner**

Create `src/components/auth-banner.tsx`:

```typescript
/**
 * @file Sticky global banner for Google authentication errors.
 *
 * Appears whenever any surface reports an AuthErrorPayload (API 401s via
 * authAwareFetch, streamed tool errors via chat-message). Offers a
 * copy-to-clipboard for the remedy command and a "Check again" button
 * that probes /api/auth/health; on 200 the banner clears, on 401 it
 * refreshes with the latest payload.
 *
 * Sticky by design: the only way to dismiss is a successful health
 * check. This keeps the state honest — silent auto-clear could hide a
 * flapping or partially-restored session.
 */

"use client";

import { useState } from "react";
import { ShieldAlert, Copy, Check, RefreshCw } from "lucide-react";
import { useAuthHealth } from "@/components/auth-health-provider";

/**
 * Renders the banner only when the context holds an error. Keeping the
 * conditional inside the component (rather than the caller) means the
 * root layout can mount it unconditionally.
 */
export function AuthBanner() {
  const { error, report, clear } = useAuthHealth();
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);

  if (!error) return null;

  async function handleCheckAgain() {
    setChecking(true);
    try {
      const res = await fetch("/api/auth/health");
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: unknown;
      };
      if (res.ok && body.ok) {
        clear();
        return;
      }
      if (body.error && typeof body.error === "object" && "code" in body.error) {
        report(body.error as typeof error);
      }
    } finally {
      setChecking(false);
    }
  }

  async function handleCopy() {
    if (!error?.command) return;
    await navigator.clipboard.writeText(error.command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div
      role="alert"
      aria-live="polite"
      className="bg-warning-light text-warning-on ring-warning/30 flex flex-col gap-2 px-4 py-2.5 text-sm ring-1 sm:flex-row sm:items-center"
    >
      <ShieldAlert className="size-4 shrink-0" aria-hidden="true" />
      <div className="flex-1">
        <p className="font-medium">{error.remedy}</p>
        <p className="text-warning-on/80 text-xs">{error.message}</p>
      </div>

      {error.command && (
        <button
          type="button"
          onClick={handleCopy}
          className="state-layer ring-warning/30 inline-flex items-center gap-1.5 rounded-[var(--radius-xs)] bg-white/50 px-2 py-1 font-mono text-xs ring-1"
          aria-label={`Copy command: ${error.command}`}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          <span>{error.command}</span>
        </button>
      )}

      <button
        type="button"
        onClick={handleCheckAgain}
        disabled={checking}
        className="state-layer ring-warning/30 inline-flex items-center gap-1.5 rounded-[var(--radius-xs)] px-2 py-1 text-xs font-medium ring-1 disabled:opacity-50"
      >
        <RefreshCw className={checking ? "size-3 animate-spin" : "size-3"} aria-hidden="true" />
        {checking ? "Checking…" : "Check again"}
      </button>

      {error.docsUrl && (
        <a
          href={error.docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-primary text-xs underline"
        >
          Details
        </a>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify the `warning` color tokens exist; fall back to neutral amber if not**

Run: `grep -n "warning" src/app/globals.css`
Expected: at least one hit. If none exist, replace every `warning-light`/`warning-on`/`warning/30` class above with literal amber classes (`bg-amber-100 text-amber-900 ring-amber-300`). Don't add new tokens just for the banner — match existing conventions.

- [ ] **Step 3: Commit**

```bash
git add src/components/auth-banner.tsx
git commit -m "Add AuthBanner with copy-command and Check-again probe"
```

---

## Task 11: Mount AuthHealthProvider and AuthBanner in the root layout

**Files:**
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Update the root layout**

Edit `src/app/layout.tsx`. Replace the `<body>` block with:

```typescript
import { AuthHealthProvider } from "@/components/auth-health-provider";
import { AuthBanner } from "@/components/auth-banner";
```

(place alongside other imports) and replace the JSX return with:

```tsx
  return (
    <html lang="en" className={`${roboto.variable} ${robotoMono.variable} h-full`}>
      <body className="flex min-h-dvh flex-col antialiased">
        <AuthHealthProvider>
          <AuthBanner />
          {children}
        </AuthHealthProvider>
      </body>
    </html>
  );
```

- [ ] **Step 2: Run the dev server and confirm the app still loads**

Run: `npm run dev`
Expected: app renders, no banner visible (no auth error in state yet). Ctrl-C when confirmed.

- [ ] **Step 3: Commit**

```bash
git add src/app/layout.tsx
git commit -m "Mount AuthHealthProvider and AuthBanner in root layout"
```

---

## Task 12: user-selector uses authAwareFetch and structured payload

**Files:**
- Modify: `src/components/user-selector.tsx`

- [ ] **Step 1: Replace fetch with authAwareFetch and the credential heuristic with a typed payload check**

Edit `src/components/user-selector.tsx`.

1. Add imports at the top, alongside the existing imports from `@/lib/errors`:

```typescript
import { authAwareFetch } from "@/lib/auth-aware-fetch";
import type { AuthErrorPayload } from "@/lib/auth-errors";
```

2. Add a new `useState` alongside the existing ones at the top of the component (next to the `error` state at line 33), and then replace the whole `search = useCallback(...)` block below it. The full region — the new state declaration followed by the replacement callback — is:

```typescript
  const [authPayload, setAuthPayload] = useState<AuthErrorPayload | null>(null);

  const search = useCallback(async (q: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const id = ++requestIdRef.current;
    setState("loading");
    setError(null);
    setAuthPayload(null);

    try {
      const response = await authAwareFetch(`/api/users?q=${encodeURIComponent(q)}`, {
        signal: controller.signal,
      });

      if (id !== requestIdRef.current) return;

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string | AuthErrorPayload;
        };
        if (response.status === 401 && isPayload(body.error)) {
          setAuthPayload(body.error);
          setError(body.error.remedy);
          setState("error");
          return;
        }
        throw new Error(
          typeof body.error === "string" ? body.error : `HTTP ${response.status}`,
        );
      }

      const body: unknown = await response.json();
      const list =
        body && typeof body === "object" && "users" in body && Array.isArray(body.users)
          ? (body.users as DirectoryUser[])
          : [];

      if (id !== requestIdRef.current) return;

      setUsers(list);
      setState(list.length > 0 ? "results" : "empty");
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(getErrorMessage(err));
      setState("error");
    }
  }, []);
```

3. Replace the old `isCredentialError` block (lines ~148-155) with:

```typescript
  const isCredentialError = authPayload !== null;
```

4. Inside the component but before `return`, add the payload guard:

```typescript
  function isPayload(v: unknown): v is AuthErrorPayload {
    return (
      typeof v === "object" &&
      v !== null &&
      typeof (v as AuthErrorPayload).code === "string" &&
      typeof (v as AuthErrorPayload).remedy === "string"
    );
  }
```

(Declare it inside the function so it's private; it's a tiny guard, no need to export it.)

5. In the `error` branch of the dropdown, replace the existing markup with:

```tsx
            {state === "error" && (
              <div className="px-3 py-3">
                <p className="text-error text-xs font-medium">
                  {isCredentialError ? "Credential Error" : "Search Failed"}
                </p>
                <p className="text-error/80 mt-1 text-[11px] leading-4">{error}</p>
                {authPayload?.command && (
                  <code className="bg-surface-container text-on-surface-variant mt-1.5 block rounded-[var(--radius-xs)] px-2 py-1 font-mono text-[11px]">
                    {authPayload.command}
                  </code>
                )}
                <button
                  type="button"
                  onMouseDown={() => search(query)}
                  className="state-layer text-primary mt-2 rounded-[var(--radius-xs)] px-2 py-1 text-xs font-medium"
                >
                  Retry
                </button>
              </div>
            )}
```

- [ ] **Step 2: Manually verify in the dev server after implementation**

Run: `npm run dev`
Expected: user dropdown loads normally when auth is healthy; no regressions in typeahead.

- [ ] **Step 3: Commit**

```bash
git add src/components/user-selector.tsx
git commit -m "Route user-selector through authAwareFetch and typed payload"
```

---

## Task 13: chat-message renders auth card + dispatches banner event

**Files:**
- Modify: `src/components/chat-message.tsx`

- [ ] **Step 1: Add the auth-card branch**

Edit `src/components/chat-message.tsx`.

1. Add imports at the top:

```typescript
import { useEffect } from "react";
import { reportAuthErrorGlobally } from "@/lib/auth-aware-fetch";
import type { AuthErrorPayload } from "@/lib/auth-errors";
```

(`useEffect` may already be imported via the existing `useState` line — add `useEffect` to that import.)

2. Below `ToolPartCard`, add:

```typescript
/**
 * Runtime detection of the AuthErrorPayload wire shape inside a tool
 * part's errorText. The AI SDK serializes thrown errors' messages, so
 * our AuthError's message is a plain string — we also stash the payload
 * in the error cause for structured access when available.
 */
function parseAuthPayload(errorText: unknown): AuthErrorPayload | null {
  if (typeof errorText !== "string") return null;
  try {
    const parsed = JSON.parse(errorText);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.code === "string" &&
      typeof parsed.remedy === "string"
    ) {
      return parsed as AuthErrorPayload;
    }
  } catch {
    // Not JSON — fall through and try substring matching as a last resort.
  }
  return null;
}

/**
 * Distinguished auth-error card. Amber (call to action) instead of red
 * (failure), so the user's eye goes straight to the remedy.
 */
function AuthToolCard({ payload }: { payload: AuthErrorPayload }) {
  useEffect(() => {
    reportAuthErrorGlobally(payload);
  }, [payload]);

  return (
    <div className="bg-warning-light text-warning-on ring-warning/30 my-1.5 rounded-[var(--radius-sm)] px-3 py-2 text-xs ring-1">
      <p className="font-semibold">Authentication required</p>
      <p className="text-warning-on/80 mt-0.5 leading-4">{payload.remedy}</p>
      {payload.command && (
        <code className="bg-surface-container text-on-surface-variant mt-1.5 inline-block rounded-[var(--radius-xs)] px-1.5 py-0.5 font-mono text-[11px]">
          {payload.command}
        </code>
      )}
      {payload.docsUrl && (
        <a
          href={payload.docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary ml-2 text-[11px] underline"
        >
          Details
        </a>
      )}
    </div>
  );
}
```

3. Update `ToolPartCard` so `state === "output-error"` branches into the auth card when `errorText` parses as a payload. Replace the `return` with:

```tsx
  const errorText = "errorText" in part ? part.errorText : undefined;
  const authPayload = parseAuthPayload(errorText);

  if (authPayload) {
    return <AuthToolCard payload={authPayload} />;
  }

  return (
    <div className="bg-surface-dim ring-on-surface/10 my-1.5 rounded-[var(--radius-sm)] ring-1">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
      >
        <span className="text-on-surface flex-1 truncate font-mono text-xs">
          {getToolName(part)}
        </span>
        <span
          className={cn(
            "inline-flex items-center rounded-[var(--radius-xs)] px-1.5 py-0.5 text-[0.625rem] font-semibold tracking-wide uppercase",
            badgeClass,
          )}
        >
          {label}
        </span>
      </button>

      {expanded && (
        <div className="border-on-surface/5 border-t px-2.5 py-2">
          <pre className="bg-surface-container text-on-surface-variant overflow-x-auto rounded-[var(--radius-xs)] p-2.5 font-mono text-[0.6875rem] leading-4">
            {JSON.stringify(
              {
                input: part.input,
                output: "output" in part ? part.output : undefined,
                errorText,
              },
              null,
              2,
            )}
          </pre>
        </div>
      )}
    </div>
  );
```

- [ ] **Step 2: Run all tests**

Run: `npm run test`
Expected: PASS on everything. `AuthError.message` is already JSON (set in Task 1), so the chat-message parser finds the payload unchanged.

- [ ] **Step 3: Commit**

```bash
git add src/components/chat-message.tsx
git commit -m "Render amber auth-tool card in chat and dispatch banner event"
```

---

## Task 14: Doctor ADC probe

**Files:**
- Modify: `src/lib/doctor-checks.ts`
- Modify: `src/lib/doctor.ts`

- [ ] **Step 1: Add `probeAdcToken` to doctor-checks**

Edit `src/lib/doctor-checks.ts`. Append at the bottom:

```typescript
/**
 * Probes Google ADC by requesting an access token. Catches AuthError
 * and returns its remedy so the doctor can tell the user exactly what
 * to run — no more "ADC looks fine until the chat call fails".
 */
export async function probeAdcToken(): Promise<CheckResult> {
  try {
    const { getADCToken } = await import("./adc");
    await getADCToken();
    return { ok: true, message: "Google ADC token acquired" };
  } catch (error) {
    const { isAuthError } = await import("./auth-errors");
    if (isAuthError(error)) {
      const cmd = error.command ? ` (run: ${error.command})` : "";
      return {
        ok: false,
        message: `Google ADC unavailable — ${error.remedy}${cmd}`,
      };
    }
    return {
      ok: false,
      message: `Google ADC probe failed — ${getErrorMessage(error)}`,
    };
  }
}
```

- [ ] **Step 2: Wire it into doctor.ts**

Edit `src/lib/doctor.ts`:

1. Add `probeAdcToken` to the destructured import near the top:

```typescript
import {
  PASS,
  FAIL,
  WARN,
  probeMcpServer,
  probeAnthropicKey,
  probeGeminiKey,
  probeAdcToken,
} from "./doctor-checks";
```

2. Right after `console.log("\nRuntime checks:");` (line 130) and before the `mcpUrl` block, insert:

```typescript
  const adcResult = await probeAdcToken();
  report(adcResult.ok, adcResult.message);
  if (!adcResult.ok) {
    console.log(`  ${WARN}   This only blocks ADC-backed calls (service_account mode).`);
  }
```

- [ ] **Step 3: Run the doctor manually**

Run: `npm run doctor`
Expected: prints `Google ADC token acquired` (or the specific remedy if ADC is broken). Exit code 0 when healthy.

- [ ] **Step 4: Commit**

```bash
git add src/lib/doctor-checks.ts src/lib/doctor.ts
git commit -m "Probe Google ADC in npm run doctor"
```

---

## Task 15: Docs + comment cleanup

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md` (CLAUDE.md and GEMINI.md are symlinks or duplicates — check with `ls -la`; update each real file)
- Modify: `src/app/api/users/activity/route.ts` (tighten the comment)

- [ ] **Step 1: Inspect the three agent docs to see which are real files**

Run: `ls -la /home/feel/pocket-cep/AGENTS.md /home/feel/pocket-cep/CLAUDE.md /home/feel/pocket-cep/GEMINI.md`
Expected: one of these forms:
- All three are real files with near-identical content (most likely): update all three identically.
- Two are symlinks to `AGENTS.md`: update `AGENTS.md` once.

- [ ] **Step 2: Add an "ADC session expiry" section to `README.md`**

Find the existing "Troubleshooting" or equivalent section (`grep -n "^##" README.md`). If one exists, append under it; otherwise add a new section before the final footer:

```markdown
## When your Google session expires

The app uses Google Application Default Credentials (ADC). If you see an
amber "Re-authenticate with Google" banner, or `npm run doctor` reports
`Google ADC unavailable`, run:

```
gcloud auth login
```

(or `gcloud auth application-default login` if ADC was never set up).
Then click "Check again" in the banner — it will clear when Google
accepts the refreshed credentials.

The banner is sticky on purpose. It only clears after a successful
probe, so you always know whether auth is healthy.
```

- [ ] **Step 3: Add an AuthError contract note to each AGENTS.md variant**

Append this section to each agent-docs file (`AGENTS.md`, and the others if they're separate files):

```markdown
## Auth Error Contract

All Google API failures (ADC, Admin SDK, MCP tool errors) flow through
`src/lib/auth-errors.ts`. When you add a new Google-backed call:

1. Let `AuthError` propagate from server-side helpers. Don't swallow it.
2. In a route handler: catch with `isAuthError(err)` and return
   `NextResponse.json({ error: err.toPayload() }, { status: 401 })`.
3. On the client: fetch through `authAwareFetch` so 401s light up the
   banner automatically.
4. For new error shapes Google throws, extend `toAuthError()` rather
   than adding ad-hoc substring checks in call sites.

Never add a `try/catch` that returns empty data on credential failure —
that silently breaks the banner + doctor + chat card contract.
```

- [ ] **Step 4: Tighten the activity-route comment**

Edit `src/app/api/users/activity/route.ts`. Replace the "degrade silently" comment block inside the non-auth catch with:

```typescript
    /**
     * Auth errors are handled above. Non-auth failures (quota, transient
     * 5xx) fall through to an empty map — the selector works fine
     * without activity badges.
     */
```

- [ ] **Step 5: Commit the docs pass**

```bash
git add README.md AGENTS.md CLAUDE.md GEMINI.md src/app/api/users/activity/route.ts
git commit -m "Document AuthError contract and ADC session expiry flow"
```

(Only add files that actually exist and changed — if `CLAUDE.md` is a symlink, `git add` may no-op, which is fine.)

---

## Task 16: Manual end-to-end verification

**Files:** none — this task is runbook-only.

- [ ] **Step 1: Confirm the happy path still works**

Run: `npm run check`
Expected: `typecheck && lint && test:unit && test:integration` all green.

- [ ] **Step 2: Force an auth failure**

Option A (preferred — reversible): revoke the local session: `gcloud auth application-default revoke`.
Option B: rename `~/.config/gcloud/application_default_credentials.json` temporarily.

- [ ] **Step 3: Run the doctor**

Run: `npm run doctor`
Expected: `Google ADC unavailable — …` with the remedy command printed. Exit code non-zero.

- [ ] **Step 4: Start the app and hit each surface**

Run: `npm run dev:full`

Verify:
- Amber banner appears at the top of the page.
- "Copy" button puts `gcloud auth login` on the clipboard.
- User-selector dropdown shows "Credential Error" with the remedy command.
- Sending a chat message that triggers a tool call renders the amber "Authentication required" card (not the red generic one).
- Clicking "Check again" while ADC is still broken keeps the banner (with a fresh payload).

- [ ] **Step 5: Re-authenticate and confirm the banner clears**

Run (in another terminal): `gcloud auth application-default login`
Back in the browser, click "Check again".
Expected: banner disappears; user-selector and chat recover on next request.

- [ ] **Step 6: No commit — this is a sign-off step**

Report to the reviewer: all six manual checks observed, no regressions in the happy path, typecheck + lint + tests all green.

---

## Post-Implementation Review

- Spec items fully covered (map against `docs/superpowers/specs/2026-04-17-auth-error-handling-design.md`):
  - ✅ Typed `AuthError` + classifier (Task 1).
  - ✅ Fail-loud plumbing: `getADCToken` throws (Task 2), `/api/users` returns 401 (Task 3), `/api/users/activity` stops degrading (Task 4), `/api/chat` 401 before stream (Task 7), MCP tool wrapper converts (Task 6).
  - ✅ `/api/auth/health` (Task 5).
  - ✅ Global sticky banner + event bus (Tasks 8-11).
  - ✅ user-selector + chat-message consume the typed payload (Tasks 12-13).
  - ✅ Doctor ADC probe (Task 14).
  - ✅ Docs + comment cleanup (Task 15).
  - ✅ Manual e2e (Task 16).

- Unit + integration tests updated per the spec's testing section (every touched module has coverage either added or explicitly unchanged).
