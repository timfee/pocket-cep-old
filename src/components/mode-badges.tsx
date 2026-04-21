/**
 * @file Compact pills that explain the active flavor.
 *
 * Shows the current AUTH_MODE pill alongside the model selector in
 * the app bar so a new engineer can tell — at a glance — how the app
 * is authenticating to Google, and can pick which LLM drives the chat.
 */

"use client";

import { useState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { useMode, type ModeInfo } from "./mode-provider";
import { ModelSelector } from "./model-selector";

type Flavor = {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  tooltip: string;
};

function authFlavor(mode: ModeInfo["authMode"]): Flavor {
  if (mode === "service_account") {
    return {
      icon: ShieldCheck,
      label: "Service account",
      tooltip:
        "ADC authenticates server-side. No user sign-in; every request uses the same Google credentials.",
    };
  }
  return {
    icon: KeyRound,
    label: "User OAuth",
    tooltip:
      "Signed-in user's Google token is forwarded to the MCP server. Each caller acts as themselves.",
  };
}

/**
 * Renders the AUTH_MODE pill and the model selector dropdown side by
 * side. Kept compact to fit comfortably in the app bar.
 */
export function ModeBadges() {
  const mode = useMode();
  const auth = authFlavor(mode.authMode);

  return (
    <div className="flex items-center gap-1.5 max-sm:hidden" aria-label="Active flavor">
      <ModePill flavor={auth} />
      <ModelSelector />
    </div>
  );
}

function ModePill({ flavor }: { flavor: Flavor }) {
  const [show, setShow] = useState(false);
  const Icon = flavor.icon;
  return (
    <span className="relative">
      <button
        type="button"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onFocus={() => setShow(true)}
        onBlur={() => setShow(false)}
        aria-describedby={`mode-tooltip-${flavor.label}`}
        className="state-layer bg-surface-dim text-on-surface-variant ring-on-surface/10 inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[0.75rem] font-medium ring-1"
      >
        <Icon className="text-primary size-3" aria-hidden="true" />
        {flavor.label}
      </button>
      {show && (
        <span
          id={`mode-tooltip-${flavor.label}`}
          role="tooltip"
          className="bg-on-surface text-surface ring-on-surface/10 pointer-events-none absolute top-full left-1/2 z-30 mt-1.5 w-64 -translate-x-1/2 rounded-[var(--radius-xs)] px-2 py-1.5 text-[0.6875rem] leading-4 shadow-[var(--shadow-elevation-2)] ring-1"
        >
          {flavor.tooltip}
        </span>
      )}
    </span>
  );
}
