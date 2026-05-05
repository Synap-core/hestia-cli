"use client";

/**
 * CP authentication banner — translucent inline notice for the OS pane.
 *
 * Built on HeroUI primitives (Card + Button) so its colors come from
 * the centralized theme tokens — no rogue Tailwind classes that risk
 * dark-text-on-dark-background contrast bugs.
 *
 * States:
 *   • `signed-out` — no `cp.userToken` on disk. Sign-in CTA.
 *   • `error`      — marketplace returned a non-401 / network failed.
 *                    Retry CTA.
 *   • `working`    — banner is hidden (renders null).
 *
 * Visibility relies on the visionOS vibrancy rule: text uses
 * `text-foreground` with opacity tiers so it adapts to both modes
 * regardless of how translucent the surface is.
 *
 * See: synap-team-docs/content/team/platform/eve-os-vision.mdx §6
 *      synap-team-docs/content/team/platform/eve-os-home-design.mdx §7
 */

import { useState } from "react";
import { Card, CardBody, Button } from "@heroui/react";
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
    return <SignedOutBanner onSignIn={onSignIn} />;
  }

  // state.kind === "error"
  return (
    <Card
      isBlurred
      shadow="none"
      radius="lg"
      classNames={{
        base: "bg-warning/10 border border-warning/30",
      }}
    >
      <CardBody className="flex flex-row items-center gap-3 px-4 py-2.5">
        <AlertTriangle className="h-4 w-4 shrink-0 text-warning" strokeWidth={2} aria-hidden />
        <p className="flex-1 min-w-0 text-[13px] text-foreground">
          Couldn&apos;t reach marketplace
          {state.message ? <span className="text-foreground/55"> — {state.message}</span> : null}
          .
        </p>
        <Button
          color="warning"
          variant="flat"
          size="sm"
          radius="full"
          onPress={() => onRetry?.()}
          isDisabled={!onRetry}
          startContent={<RefreshCw className="h-3 w-3" />}
          className="font-medium"
        >
          Retry
        </Button>
      </CardBody>
    </Card>
  );
}

// ─── Signed-out variant — handles its own click + error feedback ────────────

function SignedOutBanner({ onSignIn }: { onSignIn?: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleClick = async () => {
    setError(null);
    setPending(true);
    try {
      if (onSignIn) {
        onSignIn();
        return;
      }
      await initiateCpOAuth();
      // If the redirect didn't fire within ~1.5s, something silently
      // failed (DNS, CORS, etc.). Surface a hint so the user knows.
      window.setTimeout(() => {
        if (document.visibilityState !== "hidden") {
          setError("Couldn't reach Synap. Check your network or CP URL.");
          setPending(false);
        }
      }, 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start sign-in");
      setPending(false);
    }
  };

  return (
    <Card
      isBlurred
      shadow="none"
      radius="lg"
      classNames={{
        base: error
          ? "bg-warning/10 border border-warning/30"
          : "bg-foreground/[0.04] border border-foreground/[0.08]",
      }}
    >
      <CardBody className="flex flex-row items-center gap-3 px-4 py-2.5">
        {error ? (
          <AlertTriangle
            className="h-4 w-4 shrink-0 text-warning"
            strokeWidth={2}
            aria-hidden
          />
        ) : (
          <LogIn
            className="h-4 w-4 shrink-0 text-primary"
            strokeWidth={2}
            aria-hidden
          />
        )}
        <p className="flex-1 min-w-0 text-[13px] text-foreground">
          {error ?? "Sign in to see your apps from the Synap marketplace."}
        </p>
        <Button
          color="primary"
          variant="solid"
          size="sm"
          radius="full"
          isLoading={pending}
          onPress={() => void handleClick()}
          className="font-medium"
        >
          Sign in
        </Button>
      </CardBody>
    </Card>
  );
}
