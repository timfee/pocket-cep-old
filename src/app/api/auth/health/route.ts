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
