"use client";

/**
 * `InstallButton` — single per-card action with a 4-state machine.
 *
 *   idle        — first render. CTA depends on app type:
 *                   url            → "Launch"
 *                   eve_component  → "Install"
 *                   workspace_pack → "Add to pod"
 *                   bundle         → "Install bundle"
 *   working     — POST in flight. Spinner.
 *   installed   — success. After url/launch, this opens the URL.
 *   error       — surfaces inline message; click retries.
 *
 * The CP server-side `installApp()` call is idempotent — re-clicking
 * after a flake is safe.
 *
 * Auth: cpFetch handles 401 by triggering OAuth re-auth. We swallow
 * that here so the page can keep its banner; if the user was bounced,
 * they'll land back here after the round-trip.
 */

import { useState } from "react";
import { Button } from "@heroui/react";
import { Check, ExternalLink, Loader2, Terminal, AlertCircle } from "lucide-react";
import {
  CpUnauthorizedError,
  installApp,
  MarketplaceError,
  type MarketplaceAppWithEntitlement,
} from "../../lib/marketplace-client";

interface InstallButtonProps {
  app: MarketplaceAppWithEntitlement;
  /** Called on success so the parent can refresh the catalog (entitlement flips). */
  onInstalled?: () => void;
}

type State =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "installed" }
  | { kind: "error"; message: string };

export function InstallButton({ app, onInstalled }: InstallButtonProps) {
  const [state, setState] = useState<State>(
    // Pre-installed — render the "Open"/"Launch" terminal state on mount.
    app.entitled ? { kind: "installed" } : { kind: "idle" },
  );

  // Per-app-type label for the idle CTA.
  const idleLabel = (() => {
    switch (app.appType) {
      case "url":            return "Launch";
      case "eve_component":  return "Install";
      case "workspace_pack": return "Add to pod";
      case "bundle":         return "Install bundle";
      default:               return "Open";
    }
  })();

  // For url + workspace_pack, "installed" means we just open the appUrl.
  // For eve_component, the lifecycle handler runs server-side; we tell
  // the parent to refresh, then offer "Open" once the local component
  // surface picks it up (handled by useHomeApps).
  const handleClick = async () => {
    if (state.kind === "working") return;

    // Already installed — open the appUrl directly (no install POST).
    if (state.kind === "installed" && app.appUrl) {
      window.open(app.appUrl, "_blank", "noopener,noreferrer");
      return;
    }

    setState({ kind: "working" });
    try {
      const res = await installApp(
        { slug: app.slug },
        { onUnauthorized: () => { /* swallow — banner handles it */ } },
      );
      setState({ kind: "installed" });
      onInstalled?.();
      // For `url` apps the install is just a click record; immediately
      // open the destination so the user gets one-click flow.
      if (res.app.appType === "url" && res.app.appUrl) {
        window.open(res.app.appUrl, "_blank", "noopener,noreferrer");
      }
    } catch (err) {
      if (err instanceof CpUnauthorizedError) {
        // Banner takes over; reset to idle so the page can retry post-auth.
        setState({ kind: "idle" });
        return;
      }
      const message =
        err instanceof MarketplaceError
          ? `Couldn't install: ${err.message}`
          : err instanceof Error
            ? err.message
            : "Install failed";
      setState({ kind: "error", message });
    }
  };

  const isWorking = state.kind === "working";

  if (state.kind === "error") {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button
          size="sm"
          radius="full"
          variant="flat"
          color="danger"
          startContent={<AlertCircle className="h-3.5 w-3.5" />}
          onPress={handleClick}
        >
          Retry
        </Button>
        <p className="text-[11px] text-foreground/55">{state.message}</p>
      </div>
    );
  }

  if (state.kind === "installed") {
    return (
      <Button
        size="sm"
        radius="full"
        variant="flat"
        color="success"
        startContent={
          app.appUrl ? (
            <ExternalLink className="h-3.5 w-3.5" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )
        }
        onPress={handleClick}
        aria-label={`Open ${app.name}`}
      >
        {app.appUrl ? "Open" : "Installed"}
      </Button>
    );
  }

  return (
    <Button
      size="sm"
      radius="full"
      variant="flat"
      color="primary"
      isDisabled={isWorking}
      startContent={
        isWorking ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : app.appType === "eve_component" ? (
          <Terminal className="h-3.5 w-3.5" />
        ) : null
      }
      onPress={handleClick}
      aria-label={`${idleLabel} ${app.name}`}
    >
      {isWorking ? "Installing…" : idleLabel}
    </Button>
  );
}
