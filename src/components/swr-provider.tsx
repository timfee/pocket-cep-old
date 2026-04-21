/**
 * @file Wraps the app in an SWRConfig with a shared auth-aware fetcher
 * and a localStorage cache provider.
 *
 * Why this lives in its own file: `SWRConfig` is a Client Component (it
 * uses React context). Keeping the provider isolated lets the root layout
 * stay close to the App Router idiom — server-rendered metadata, with
 * client-only context wrappers as small leaf modules.
 *
 * **Auth contract**: the fetcher uses `authAwareFetch`, which dispatches
 * a window event for any 401 carrying an AuthErrorPayload. The
 * AuthHealthProvider listens for that event and lights up the global
 * banner. Routes that 304 (via the conditional-GET helper) flow through
 * the browser HTTP cache transparently — SWR sees the cached body and
 * hands it to consumers as if it were fresh.
 */

"use client";

import { SWRConfig, type Cache } from "swr";
import type { ReactNode } from "react";
import { authAwareFetch } from "@/lib/auth-aware-fetch";
import { isAuthErrorPayload } from "@/lib/auth-errors";

/**
 * localStorage key for the SWR cache snapshot. Versioned so a payload-
 * shape change in a future release doesn't get hydrated into an
 * incompatible client.
 */
const SWR_CACHE_KEY = "cep_swr_cache_v1";

/**
 * Default fetcher passed to every `useSWR` call. Routes return JSON; we
 * throw on non-2xx so SWR exposes an `error` to consumers. Auth
 * payloads are still surfaced via the global banner because
 * `authAwareFetch` dispatches the window event before we throw.
 */
async function defaultFetcher<T>(url: string): Promise<T> {
  const res = await authAwareFetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: unknown };
    if (isAuthErrorPayload(body.error)) {
      const err = new Error(body.error.message) as Error & { authPayload: typeof body.error };
      err.authPayload = body.error;
      throw err;
    }
    throw new Error(typeof body.error === "string" ? body.error : `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

/**
 * Persists the SWR cache to localStorage on `beforeunload` so the next
 * page load hydrates instantly from disk while a background revalidate
 * fetches the freshest data. We rebuild the Map on mount.
 */
function localStorageProvider(): Cache {
  if (typeof window === "undefined") return new Map();

  let initial: Array<[string, unknown]> = [];
  try {
    const cached = localStorage.getItem(SWR_CACHE_KEY);
    if (cached) initial = JSON.parse(cached) as Array<[string, unknown]>;
  } catch {
    // Corrupt or missing — start empty.
  }
  const map = new Map<string, unknown>(initial);

  window.addEventListener("beforeunload", () => {
    try {
      localStorage.setItem(SWR_CACHE_KEY, JSON.stringify(Array.from(map.entries())));
    } catch {
      // Quota exceeded or storage disabled — skip persistence.
    }
  });

  return map as Cache;
}

/**
 * App-wide SWR provider. Sets sensible defaults:
 *
 * - `dedupingInterval: 30s` — bounds the revalidate-on-focus rate.
 * - `revalidateOnFocus: true` — picks up server changes when the user
 *   returns to the tab.
 * - `errorRetryCount: 3` — tolerates dev-time MCP startup races.
 * - `provider`: localStorage-backed Map so reloads paint cached data
 *   immediately while fresh data fetches in the background.
 */
export function SwrProvider({ children }: { children: ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher: defaultFetcher,
        provider: localStorageProvider,
        dedupingInterval: 30_000,
        revalidateOnFocus: true,
        errorRetryCount: 3,
      }}
    >
      {children}
    </SWRConfig>
  );
}
