# Auth Error Handling Design

**Date:** 2026-04-17
**Status:** Approved, ready for implementation planning

## Problem

The app swallows ADC credential failures silently. A Google `invalid_rapt` reauth error (triggered by `gcloud auth login` needing to be re-run) produces:

- `[users] Failed to get ADC token: ...` → `searchUsers()` returns `[]`
- `/api/users/activity` catches the MCP tool error and returns `{ activity: {} }` at HTTP 200 with an explicit "degrade silently" comment
- The chat UI renders MCP tool auth errors as a generic red "ERROR" badge with raw JSON
- The `user-selector` has a string-matching heuristic for credential errors, but only for `/api/users`
- `npm run doctor` does not probe ADC, so `invalid_rapt` never surfaces until a live tool call

Net effect: the user sees empty dropdowns or a cryptic error card, with no hint that the remedy is `gcloud auth login`. For an educational POC whose purpose is to teach how ADC flows work, surfacing *why* auth failed is load-bearing.

## Goals

1. Every surface that can hit ADC failure reports it with a specific, actionable message.
2. One shared detector turns raw errors (Google OAuth JSON, gaxios errors, MCP tool-error strings) into a typed `AuthError` with a remedy.
3. A global, sticky banner appears whenever any surface observes an auth error, and clears only after a successful health check.
4. `npm run doctor` catches `invalid_rapt` before runtime.
5. Unit tests, JSDoc comments, and README/AGENTS guidance are updated to match.

## Non-Goals

- No change to the auth mechanism itself (still gcloud ADC).
- No automatic `gcloud` invocation from the app — the user still runs the command themselves.
- No session caching or token refresh strategy beyond what `google-auth-library` already does.

## Architecture

### New module: `src/lib/auth-errors.ts`

A single source of truth for classifying and describing auth errors.

```ts
/**
 * @file Typed auth-error classification and detection for ADC / MCP tool failures.
 */

export type AuthErrorCode =
  | "invalid_rapt"      // Google reauth required (run `gcloud auth login`)
  | "invalid_grant"     // refresh token revoked/expired
  | "no_adc"            // ADC never configured
  | "unauthenticated"   // generic 401 from Google
  | "unknown_auth"      // matched auth heuristic but specific code is unclear

export interface AuthErrorPayload {
  code: AuthErrorCode
  source: "adc" | "mcp-tool" | "admin-sdk"
  message: string       // short human-readable summary
  remedy: string        // next step for the user
  command?: string      // copy-pasteable shell command (e.g., "gcloud auth login")
  docsUrl?: string      // Google's error_uri when available
}

export class AuthError extends Error implements AuthErrorPayload {
  readonly code: AuthErrorCode
  readonly source: AuthErrorPayload["source"]
  readonly remedy: string
  readonly command?: string
  readonly docsUrl?: string
  constructor(payload: AuthErrorPayload)
  toPayload(): AuthErrorPayload
}

/**
 * Attempts to classify an unknown error. Returns null if it isn't auth-related.
 * Recognised inputs:
 *   - Google OAuth JSON bodies ({error: "invalid_grant", error_subtype: "invalid_rapt", ...})
 *   - gaxios errors whose response.data matches the above
 *   - Plain Error messages containing "invalid_grant", "invalid_rapt", "UNAUTHENTICATED", etc.
 *   - MCP tool-error strings like "API Error: invalid_grant - reauth related error (invalid_rapt)"
 */
export function toAuthError(err: unknown, source: AuthErrorPayload["source"]): AuthError | null

/** Guard for type narrowing. */
export function isAuthError(err: unknown): err is AuthError
```

### Touchpoints

#### 1. `src/lib/admin-sdk.ts` (fail-loud)

- `getADCToken()` — on failure, call `toAuthError(err, "adc")`; if it classifies, throw the `AuthError`. Otherwise rethrow the original error. No more silent `null`.
- `searchUsers()` and any other Admin SDK caller — remove null checks; let `AuthError` propagate.

#### 2. API routes (fail-loud)

- `src/app/api/users/route.ts` — wrap handler in try/catch. If `isAuthError(err)`, return `401` with body `{ error: err.toPayload() }`. Otherwise 500.
- `src/app/api/users/activity/route.ts` — same pattern. **Remove** the "degrade silently — activity is a nice-to-have" behavior. An empty activity response must not masquerade as success.
- `src/app/api/chat/route.ts` — if the streaming handler throws an `AuthError` (from `getMcpToolsForAiSdk()` or elsewhere before streaming starts), return 401 with `{ error: payload }` so the chat UI can pick it up.

#### 3. New: `src/app/api/auth/health/route.ts`

```ts
/**
 * @file Health probe for Google ADC credentials. Used by the auth banner's
 * "Check again" button to verify the user has re-authenticated.
 */
GET /api/auth/health
  200 { ok: true }
  401 { ok: false, error: AuthErrorPayload }
```

Implementation: call `getADCToken()` and let `AuthError` propagate into the standard error handler. No other side effects.

#### 4. `src/lib/mcp-tools.ts` (MCP tool wrapper)

When a tool call resolves with `isError: true`, run `toAuthError(content, "mcp-tool")` on the error text. If it classifies, throw the `AuthError` so the AI SDK surfaces it as `state: 'output-error'` with `err.toPayload()` serialized into `errorText`.

#### 5. `src/components/auth-banner.tsx` + `src/components/auth-health-provider.tsx` (new)

- `AuthHealthProvider` — React context holding `{ error: AuthErrorPayload | null, reportAuthError, clear }`. Mounted in the root layout (`src/app/layout.tsx`).
- `authAwareFetch(input, init)` — small wrapper around `fetch` used by client hooks. On a JSON response matching `{ error: AuthErrorPayload }` at 401, calls `reportAuthError(payload)` via an event/bus pattern (the fetch wrapper can't use hooks directly — see "Wiring" below).
- `AuthBanner` — renders above the app chrome when `error` is set. Content:
  - Amber background (not red — this is a call to action, not a crash).
  - Title from `remedy` (e.g., "Re-authenticate with Google").
  - One-line `message`.
  - If `command` is present: a `<code>` block with a copy button.
  - "Check again" button → `GET /api/auth/health`; on 200 `{ ok: true }`, calls `clear()`. On 401, replaces the banner error with the fresh payload.
  - Docs link if `docsUrl` is present.
  - **Sticky**: does not auto-clear on successful unrelated requests. The only way to dismiss is a successful health check.

**Wiring**: `authAwareFetch` dispatches a `CustomEvent("auth-error", { detail: payload })` on `window`. The provider listens and updates its state. This keeps the fetch wrapper pure and avoids a React import from the lib layer.

#### 6. `src/components/user-selector.tsx`

Replace the current string-match `"credentials" | "expired" | ... | "invalid_grant" | "UNAUTHENTICATED"` check with a single `isAuthError`-style check on the structured 401 payload from `/api/users`. Use the same copy-command component as the banner for consistency. The in-panel error state stays (the banner is global; the panel-local error keeps the dropdown explaining why it's empty).

#### 7. `src/components/chat-message.tsx`

When a tool part is `state: 'output-error'` and `errorText` parses as an `AuthErrorPayload`, render an amber "Authentication required" card with remedy, copy-command button, and docs link. Fall back to the existing generic red ERROR badge for non-auth errors.

On first render of an auth-card tool part, dispatch the same `CustomEvent("auth-error", { detail: payload })` that `authAwareFetch` uses, so the global banner also lights up. Use a `useEffect` keyed on the payload to avoid re-dispatching on every render.

#### 8. `src/lib/doctor.ts` (preflight probe)

Add a new check, run before the MCP reachability probe:

```
Google ADC token ........ ✓ (acquired)
                          ✗ (invalid_rapt — run: gcloud auth login)
```

Implementation: call `getADCToken()` inside a try/catch, render `AuthError.remedy` and `command` on failure. Exit non-zero on failure, matching existing doctor conventions. Runs on every `npm run doctor` (confirmed in brainstorming).

## Data Flow

```
Google OAuth refresh fails
   │
   ├── getADCToken() → toAuthError(err, "adc") → throws AuthError
   │       │
   │       ├── searchUsers() lets it propagate
   │       │       └── /api/users → 401 { error: payload }
   │       │               └── user-selector: authAwareFetch → dispatches event
   │       │                       └── AuthHealthProvider state → banner renders
   │       │                       └── user-selector panel: local error state
   │       └── /api/users/activity → 401 { error: payload } → same path
   │
   └── MCP tool wrapper: isError content matched by toAuthError(_, "mcp-tool")
           └── throws AuthError inside AI SDK tool execute()
                   └── tool part: state="output-error", errorText=JSON(payload)
                           └── chat-message: renders amber auth card
                           └── chat route API streams error → client can also reportAuthError

Check again button → GET /api/auth/health
   200 { ok: true } → provider.clear() → banner disappears
   401 { ok: false, error } → provider.reportAuthError(error) → banner stays with fresh payload
```

## Error-Shape Contract (API boundary)

All API routes that can fail auth return this shape at HTTP 401:

```json
{
  "error": {
    "code": "invalid_rapt",
    "source": "adc",
    "message": "Google requires you to re-authenticate.",
    "remedy": "Run `gcloud auth login` and retry.",
    "command": "gcloud auth login",
    "docsUrl": "https://support.google.com/a/answer/9368756"
  }
}
```

This is the only contract clients need to know. `authAwareFetch` and the MCP tool wrapper both emit this shape.

## Testing

### Unit tests (`src/__tests__/unit/auth-errors.test.ts` — new)

- `toAuthError` classifies:
  - Google OAuth JSON with `error_subtype: "invalid_rapt"` → `code: "invalid_rapt"`
  - JSON with `error: "invalid_grant"` (no subtype) → `code: "invalid_grant"`
  - gaxios-shaped error with nested `response.data.error: "invalid_grant"` → same as above
  - MCP tool string `"API Error: invalid_grant - reauth related error (invalid_rapt)"` → `code: "invalid_rapt"`, `source: "mcp-tool"`
  - Plain 401 "UNAUTHENTICATED" → `code: "unauthenticated"`
  - Unrelated error (e.g. `TypeError`) → returns `null`
- Each classification has the correct `remedy` and `command`.
- `isAuthError` type guard narrows correctly.

### Unit tests (`src/__tests__/unit/admin-sdk.test.ts` — new or extended)

- `getADCToken()` throws `AuthError` with `source: "adc"` on mocked refresh failure.
- Non-auth errors rethrow as-is.

### Integration tests

- `src/__tests__/integration/api/users.test.ts` — add a case: when the token fetch throws `AuthError`, route returns 401 with the structured payload (not 200 with empty array).
- `src/__tests__/integration/api/auth-health.test.ts` (new) — 200 on success, 401 with payload on failure.
- `src/__tests__/integration/api/users-activity.test.ts` (new or existing) — same 401 shape as `/api/users`.

### Existing tests to audit

- `src/__tests__/unit/access-token.test.ts` — likely needs updates if it asserts the `null`-return behavior of `getADCToken`.
- `src/__tests__/unit/mcp-client.test.ts` — add coverage for the MCP tool wrapper converting error content into `AuthError`.
- `src/__tests__/integration/api/users.test.ts` — update any assertion that expects an empty-array success response on auth failure.

### Manual / e2e

- Not automating the `invalid_rapt` path e2e (requires a real expired Google session). Tested manually after implementation by revoking the local ADC session.

## Documentation Updates

- **`README.md`** — add a short "What happens when your ADC session expires" section pointing at the banner, the doctor command, and `gcloud auth login`.
- **`AGENTS.md` / `CLAUDE.md` / `GEMINI.md`** — note the `AuthError` contract so future agents route new Google-API callers through it.
- **JSDoc** — every new module (`auth-errors.ts`, `auth-health-provider.tsx`, `auth-banner.tsx`, `/api/auth/health/route.ts`) gets the project's standard file-level and exported-symbol JSDoc. Inline comments stay proportional per CLAUDE.md — explain WHY, not WHAT.
- **Delete** the "degrade silently — activity is a nice-to-have" comment in `/api/users/activity`. Replace with a short note that auth failures return 401 on purpose.

## Risks / Open Concerns

- **Health probe rate**: "Check again" hits `oauth2.googleapis.com/token` once per click. Users mashing the button could get rate-limited. Acceptable for a POC; not worth debouncing beyond a short disabled-state while in-flight.
- **`authAwareFetch` adoption**: only client-initiated fetches go through it. Server components that call `searchUsers` directly won't fire the banner on first paint. Mitigation: the first subsequent client fetch (or the chat tool call) will fire the event and pop the banner.
- **MCP tool-error string matching is brittle**: Google may change the wording of `"API Error: invalid_grant - reauth related error (invalid_rapt)"`. We match on `invalid_grant` and `invalid_rapt` substrings rather than exact format to reduce drift.

## Build Order

1. `auth-errors.ts` module + unit tests.
2. `admin-sdk.ts` throws instead of returns null; update/extend its tests.
3. API routes return structured 401; update integration tests; delete silent-degrade comment.
4. `/api/auth/health` route + integration test.
5. MCP tool wrapper converts errors; extend `mcp-client.test.ts`.
6. `AuthHealthProvider`, `authAwareFetch`, `AuthBanner` + root layout wiring.
7. `user-selector` and `chat-message` consume typed payload.
8. `doctor.ts` ADC probe.
9. Docs: README, AGENTS/CLAUDE/GEMINI, JSDoc on new files.
10. Manual verification: revoke local ADC, confirm banner + doctor + chat card + user-selector all surface the remedy.
