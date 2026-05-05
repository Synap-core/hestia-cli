"use client";

/**
 * CP authentication banner.
 *
 * Renders one of three states above the OS Home app grid:
 *
 *   • `signed-out`  — no `cp.userToken` on disk. Prompts the user to
 *                      sign in via `initiateCpOAuth()`.
 *   • `error`       — the marketplace returned a non-401 error or the
 *                      network failed. Offers a Retry button.
 *   • `working`     — banner is hidden (renders null).
 *
 * Phase 2 will mount this component above `<AppGrid />` on the OS
 * Home page. For Phase 1 of the OAuth client work it is exported but
 * NOT mounted anywhere yet — the spec is explicit about that.
 *
 * See: synap-team-docs/content/team/platform/eve-os-vision.mdx §6
 *      synap-team-docs/content/team/platform/eve-os-home-design.mdx §5.6
 */

import { Button } from "@heroui/react";
import { LogIn, RefreshCw, AlertTriangle } from "lucide-react";
import { initiateCpOAuth } from "../(os)/lib/cp-oauth";

export type CpAuthBannerState =
  /** Cleanly working — banner hidden. */
  | { kind: "working" }
  /** No CP token on disk. Show the sign-in CTA. */
  | { kind: "signed-out" }
  /** Marketplace error (network down, 5xx, etc.) — show retry. */
  | { kind: "error"; message?: string };

export interface CpAuthBannerProps {
  state: CpAuthBannerState;
  /**
   * Called when the user clicks Retry in the error state. Hosts pass
   * a refetcher (e.g. `() => mutate()`). Required for the error
   * variant; ignored for the others.
   */
  onRetry?: () => void;
  /**
   * Called instead of the default `initiateCpOAuth()` when the user
   * clicks Sign in. Useful for tests / Storybook stories that don't
   * want a real navigation.
   */
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
        <span className="text-default-500">
          <LogIn className="h-4 w-4" />
        </span>
        <p className="flex-1 min-w-0 text-sm text-foreground">
          Sign in to see your apps from the Synap marketplace.
        </p>
        <Button
          color="primary"
          size="sm"
          radius="md"
          onPress={() => (onSignIn ? onSignIn() : void initiateCpOAuth())}
        >
          Sign in
        </Button>
      </Surface>
    );
  }

  // state.kind === "error"
  return (
    <Surface tone="warning">
      <span className="text-warning">
        <AlertTriangle className="h-4 w-4" />
      </span>
      <p className="flex-1 min-w-0 text-sm text-foreground">
        Couldn&apos;t reach marketplace
        {state.message ? <span className="text-default-500"> — {state.message}</span> : null}
        .
      </p>
      <Button
        size="sm"
        radius="md"
        variant="bordered"
        startContent={<RefreshCw className="h-3.5 w-3.5" />}
        onPress={() => onRetry?.()}
        isDisabled={!onRetry}
      >
        Retry
      </Button>
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
  // Lean on existing HeroUI / Tailwind tokens — neutral surface w/ a
  // tinted border per tone. Matches the rest of the dashboard's chrome.
  const border =
    tone === "warning"
      ? "border-warning/40 bg-warning/5"
      : "border-divider bg-content1";
  return (
    <div
      className={`flex items-center gap-3 rounded-xl border ${border} px-4 py-3`}
      role="status"
      aria-live="polite"
    >
      {children}
    </div>
  );
}
