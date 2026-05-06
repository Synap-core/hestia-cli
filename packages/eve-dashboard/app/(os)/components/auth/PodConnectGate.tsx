"use client";

/**
 * `PodConnectGate` — second auth layer (sits inside `EveAccountGate`).
 *
 * Sequences pod-side bootstrap state for an already-CP-signed-in
 * operator:
 *
 *   1. **Self-hosted session** — already paired by the bootstrap flow.
 *      Render children immediately.
 *   2. **Pod URL not configured** — render the legacy
 *      `ConfigurePodCard` linking to settings.
 *   3. **Pod has no users yet** (`needsBootstrap`) AND CP user is
 *      signed in → show a "Claim this Eve as your pod" CTA card. The
 *      card embeds `<SelfHostedSignInForm fixedEmail={…} />` so the
 *      operator only confirms the bootstrap.
 *   4. **Pod paired** → render children. (Unpaired-but-initialized
 *      pods are handled by the existing pair dialog from the home
 *      header — we don't block on that here so the rest of the OS
 *      stays interactive.)
 *
 * This component intentionally does NOT show a sign-in form for the
 * pod's user-channel (that's `PodPairDialog` from the home header).
 * The two gates compose: `EveAccountGate` proves the operator owns the
 * Eve dashboard; `PodConnectGate` proves the local pod is in a usable
 * state. Anything beyond that is on-demand.
 *
 * See: synap-team-docs/content/team/platform/eve-auth-architecture.mdx
 */

import { useCallback, useState } from "react";
import { Button, Card } from "@heroui/react";
import { Plug, Server, Sparkles } from "lucide-react";
import { useSetupStatus } from "../../hooks/use-setup-status";
import { ConfigurePodCard } from "../bootstrap-admin-card";
import {
  ClaimSuccessNotice,
  SelfHostedSignInForm,
  type SelfHostedClaimResult,
} from "./EveSignInScreen";
import {
  getSharedSession,
  isSelfHostedSession,
} from "@/lib/synap-auth";

export interface PodConnectGateProps {
  children: React.ReactNode;
}

export function PodConnectGate({ children }: PodConnectGateProps) {
  const { state: setupState, refetch } = useSetupStatus();
  const [claim, setClaim] = useState<SelfHostedClaimResult | null>(null);

  // Self-hosted mode — already bootstrapped via the sign-in flow.
  const session = typeof window !== "undefined" ? getSharedSession() : null;
  if (session && isSelfHostedSession(session)) {
    return <>{children}</>;
  }

  // Loading the setup probe — render children optimistically so the
  // OS doesn't flicker. The probe is fast enough that the right state
  // settles within 1-2 frames.
  if (setupState === "loading" || setupState === "ready") {
    return <>{children}</>;
  }

  if (setupState === "unconfigured") {
    return (
      <div className="flex min-h-[calc(100vh-3rem)] items-center justify-center px-4 py-8">
        <ConfigurePodCard />
      </div>
    );
  }

  if (setupState === "needsBootstrap") {
    if (claim) {
      return (
        <div className="flex min-h-[calc(100vh-3rem)] items-center justify-center px-4 py-8">
          <Card
            isBlurred
            shadow="none"
            radius="md"
            className="
              flex w-full max-w-[28rem] flex-col gap-4 p-6
              bg-foreground/[0.04]
              ring-1 ring-inset ring-foreground/10
            "
          >
            <ClaimSuccessNotice
              email={claim.email}
              signupUrl={claim.signupUrl}
            />
            <Button
              color="primary"
              size="md"
              radius="md"
              onPress={() => {
                setClaim(null);
                refetch();
              }}
              className="font-medium"
            >
              Continue to Eve
            </Button>
          </Card>
        </div>
      );
    }
    return (
      <ClaimPodCard
        defaultEmail={session?.userName?.includes("@") ? session.userName : undefined}
        onSuccess={(result) => {
          setClaim(result);
          // Refetch so the next mount of `useSetupStatus()` sees `ready`.
          refetch();
        }}
      />
    );
  }

  // Unreachable / network error — let children render so the user can
  // open settings or retry; the home page surfaces its own banner.
  return <>{children}</>;
}

// ─── "Claim this pod" card ────────────────────────────────────────────────

interface ClaimPodCardProps {
  defaultEmail?: string;
  onSuccess: (result: SelfHostedClaimResult) => void;
}

function ClaimPodCard({ defaultEmail, onSuccess }: ClaimPodCardProps) {
  // Stable identity check — the CP-signed-in user's email is what the
  // pod will tie the bootstrap invite to. When we have it, lock the
  // input so the form is a one-click confirm.
  const fixedEmail = useGuessUserEmail(defaultEmail);

  return (
    <div className="flex min-h-[calc(100vh-3rem)] items-center justify-center px-4 py-8">
      <Card
        isBlurred
        shadow="none"
        radius="md"
        className="
          flex w-full max-w-[28rem] flex-col gap-5 p-6 sm:p-7
          bg-foreground/[0.04]
          ring-1 ring-inset ring-foreground/10
        "
      >
        <header className="flex items-start gap-3">
          <span
            aria-hidden
            className="
              flex h-10 w-10 shrink-0 items-center justify-center
              rounded-lg
              bg-primary/10 ring-1 ring-inset ring-primary/20
              text-primary
            "
          >
            <Server className="h-5 w-5" strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-heading text-[20px] font-medium leading-tight tracking-tight text-foreground">
              Claim this Eve as your pod
            </h2>
            <p className="mt-1 text-[13px] leading-snug text-foreground/65">
              This Eve hasn&apos;t been claimed yet. Bind it to your Synap
              account so you can use it as your sovereign data pod.
            </p>
          </div>
        </header>

        {fixedEmail ? (
          <div
            className="
              flex items-start gap-2.5
              rounded-lg
              bg-foreground/[0.03] ring-1 ring-inset ring-foreground/10
              px-3.5 py-2.5
            "
          >
            <Sparkles
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary"
              strokeWidth={2}
              aria-hidden
            />
            <p className="text-[12.5px] leading-snug text-foreground/65">
              You&apos;ll claim the pod as{" "}
              <span className="font-medium text-foreground">{fixedEmail}</span>{" "}
              — the email tied to your Synap account.
            </p>
          </div>
        ) : (
          <div
            className="
              flex items-start gap-2.5
              rounded-lg
              bg-foreground/[0.03] ring-1 ring-inset ring-foreground/10
              px-3.5 py-2.5
            "
          >
            <Plug
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary"
              strokeWidth={2}
              aria-hidden
            />
            <p className="text-[12.5px] leading-snug text-foreground/65">
              Enter the email you want to use as the pod admin. Defaults
              to your Synap account email when known.
            </p>
          </div>
        )}

        <SelfHostedSignInForm
          fixedEmail={fixedEmail}
          onSuccess={onSuccess}
        />
      </Card>
    </div>
  );
}

// Best-effort email guess from the shared session — not all sessions
// carry the email (legacy `userName` field), so we fall back to the
// caller-supplied default.
function useGuessUserEmail(fallback?: string): string | undefined {
  if (typeof window === "undefined") return fallback;
  const session = getSharedSession();
  // The shared session shape stores `userName`. Some surfaces stuff
  // the email in there; if it parses as an email, use it.
  if (session?.userName && session.userName.includes("@")) {
    return session.userName;
  }
  return fallback;
}

export default PodConnectGate;
