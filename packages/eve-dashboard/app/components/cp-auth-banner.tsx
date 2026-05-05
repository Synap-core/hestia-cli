"use client";

/**
 * CP authentication banner — translucent inline notice for the OS pane.
 *
 * States:
 *
 *   • `signed-out` — no `cp.userToken` on disk. Prompts the user to
 *                    sign in via `initiateCpOAuth()`.
 *   • `error`      — marketplace returned a non-401 / network failed.
 *                    Offers a Retry button.
 *   • `working`    — banner is hidden (renders null).
 *
 * Visual: a low-contrast frosted pill that reads as a system suggestion,
 * not an alarm. Sits inside the popup pane so it inherits the wallpaper
 * tint that bleeds through the pane backdrop.
 *
 * See: synap-team-docs/content/team/platform/eve-os-vision.mdx §6
 *      synap-team-docs/content/team/platform/eve-os-home-design.mdx §7
 */

import { LogIn, RefreshCw, AlertTriangle } from "lucide-react";
import { initiateCpOAuth } from "../(os)/lib/cp-oauth";

export type CpAuthBannerState =
  | { kind: "working" }
  | { kind: "signed-out" }
  | { kind: "error"; message?: string };

export interface CpAuthBannerProps {
  state: CpAuthBannerState;
  onRetry?: () => void;
  onSignIn?: () => void;
}

export function CpAuthBanner({
  state,
  onRetry,
  onSignIn,
}: CpAuthBannerProps): React.ReactElement | null {
  if (state.kind === "working") return null;

  if (state.kind === "signed-out") {
    return (
      <Surface tone="info">
        <span className="text-emerald-300/90">
          <LogIn className="h-3.5 w-3.5" strokeWidth={2} />
        </span>
        <p className="flex-1 min-w-0 text-[13px] text-default-200">
          Sign in to see your apps from the Synap marketplace.
        </p>
        <button
          type="button"
          onClick={() => (onSignIn ? onSignIn() : void initiateCpOAuth())}
          className="
            shrink-0 inline-flex h-7 items-center justify-center rounded-full
            px-3 text-[12px] font-medium text-white
            transition-[filter,transform] duration-200
            hover:brightness-110 active:scale-[0.98]
          "
          style={{
            background: "linear-gradient(135deg, #10B981 0%, #34D399 100%)",
          }}
        >
          Sign in
        </button>
      </Surface>
    );
  }

  // state.kind === "error"
  return (
    <Surface tone="warning">
      <span className="text-amber-300">
        <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2} />
      </span>
      <p className="flex-1 min-w-0 text-[13px] text-default-200">
        Couldn&apos;t reach marketplace
        {state.message ? <span className="text-default-500"> — {state.message}</span> : null}
        .
      </p>
      <button
        type="button"
        onClick={() => onRetry?.()}
        disabled={!onRetry}
        className="
          shrink-0 inline-flex h-7 items-center gap-1 rounded-full
          border border-white/10 bg-white/5 px-3
          text-[12px] font-medium text-default-200
          transition-colors hover:bg-white/10
          disabled:opacity-50 disabled:cursor-not-allowed
        "
      >
        <RefreshCw className="h-3 w-3" />
        Retry
      </button>
    </Surface>
  );
}

function Surface({
  tone,
  children,
}: {
  tone: "info" | "warning";
  children: React.ReactNode;
}) {
  // Inline frosted pill. Tone = subtle background tint at the left edge.
  // No solid border on the body — the inset shadow from the pane already
  // provides separation. Concentric rule: border-radius 12 inside a body
  // padded 20 from a pane-radius-32 surface (32 - 20 = 12 ✓).
  const tint =
    tone === "warning"
      ? "bg-amber-400/[0.06] ring-amber-400/15"
      : "bg-white/[0.04] ring-white/[0.08]";
  return (
    <div
      className={
        "flex items-center gap-3 rounded-stat-card px-3.5 py-2.5 ring-1 backdrop-blur-md " +
        tint
      }
      role="status"
      aria-live="polite"
    >
      {children}
    </div>
  );
}
