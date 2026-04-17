/**
 * @file Landing page for Pocket CEP.
 *
 * Shows a compact sign-in card following Google's sign-in page patterns:
 * centered card, logo, title, description, and the branded sign-in button.
 */

import { SignInButton } from "@/components/sign-in-button";

export default function LandingPage() {
  return (
    <div className="bg-surface-dim flex flex-1 items-center justify-center px-4">
      <main className="bg-surface ring-on-surface/10 flex w-full max-w-[400px] flex-col items-center gap-6 rounded-[var(--radius-md)] px-10 py-10 shadow-[var(--shadow-elevation-1)] ring-1">
        <div className="flex flex-col items-center gap-2">
          <svg
            viewBox="0 0 16 16"
            fill="currentColor"
            className="fill-primary size-8"
            aria-hidden="true"
          >
            <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm3.28 5.28-4 4a.75.75 0 0 1-1.06 0l-2-2a.75.75 0 1 1 1.06-1.06L6.75 8.69l3.47-3.47a.75.75 0 0 1 1.06 1.06Z" />
          </svg>
          <h1 className="text-on-surface text-[1.375rem] font-medium text-balance">Pocket CEP</h1>
        </div>

        <p className="text-on-surface-variant text-center text-pretty">
          An educational companion for the Chrome Enterprise Premium MCP server. Investigate user
          activity and chat with an AI agent.
        </p>

        <SignInButton />

        <p className="text-on-surface-muted text-center text-xs/4 text-pretty">
          Sign in with your Google Workspace account. Your credentials authenticate with the MCP
          server.
        </p>
      </main>
    </div>
  );
}
