"use client";

/**
 * `PodConnectGate` — second auth layer (sits inside `EveAccountGate`).
 *
 * Sequences pod-side state for an already-authenticated operator
 * (CP-signed-in OR pod-signed-in OR both — see `EveAccountGate`).
 *
 *   1. **Local pod already paired** (entry exists in `synap:pods` for
 *      the local pod URL) → render children. Covers Mode B
 *      (self-hosted) AND Mode A+B (CP user who already claimed).
 *   2. **CP-signed-in but local pod NOT in `synap:pods`** → show the
 *      "Claim this Eve as your pod" CTA. The card primary action
 *      calls `POST /api/pod/claim` (CP handshake → pod handshake →
 *      `pod.userToken` written + `synap:pods` updated). Falls back to
 *      the email-prompt bootstrap flow if the pod hasn't been
 *      bootstrapped yet (`needsBootstrap` from setup probe).
 *   3. **Pod URL not configured** — render the legacy
 *      `ConfigurePodCard` linking to settings.
 *
 * This component intentionally does NOT show a sign-in form for the
 * pod's user-channel (that's `PodPairDialog` from the home header).
 * The two gates compose: `EveAccountGate` proves the operator is
 * authenticated through SOMETHING; `PodConnectGate` ensures the local
 * pod is in a usable state before the OS lights up.
 *
 * See: synap-team-docs/content/team/platform/eve-auth-architecture.mdx
 */

import { useCallback, useEffect, useState } from "react";
import { Button, Card, Spinner, addToast } from "@heroui/react";
import { Plug, Server, Sparkles } from "lucide-react";
import { useSetupStatus } from "../../hooks/use-setup-status";
import { ConfigurePodCard } from "../bootstrap-admin-card";
import {
  ClaimSuccessNotice,
  SelfHostedSignInForm,
  type SelfHostedClaimResult,
} from "./EveSignInScreen";
import {
  getAllPodSessions,
  getSharedSession,
  isSelfHostedSession,
  storePodSession,
} from "@/lib/synap-auth";

export interface PodConnectGateProps {
  children: React.ReactNode;
}

/**
 * Read-only check for a pod session targeting the local pod URL.
 * SSR-safe — returns `false` on the server.
 */
function hasLocalPodSession(localPodUrl: string | null): boolean {
  if (typeof window === "undefined" || !localPodUrl) return false;
  const normalized = localPodUrl.replace(/\/+$/, "");
  return Object.values(getAllPodSessions()).some(
    (s) => s.podUrl.replace(/\/+$/, "") === normalized,
  );
}

/**
 * Infer the local pod URL from the Eve dashboard hostname.
 * Convention: `eve.DOMAIN` → `pod.DOMAIN`.
 * Returns null when the hostname doesn't follow the convention
 * (e.g. localhost, IP, or an already-configured URL from secrets).
 */
function inferPodUrlFromHostname(): string | null {
  if (typeof window === "undefined") return null;
  const { hostname, protocol } = window.location;
  if (hostname.startsWith("eve.")) {
    return `${protocol}//pod.${hostname.slice(4)}`;
  }
  return null;
}

export function PodConnectGate({ children }: PodConnectGateProps) {
  const { state: setupState, refetch } = useSetupStatus();
  const [claim, setClaim] = useState<SelfHostedClaimResult | null>(null);
  const [localPodUrl, setLocalPodUrl] = useState<string | null>(null);
  // Candidate pod URL when secrets don't have one — inferred from hostname.
  const [candidatePodUrl, setCandidatePodUrl] = useState<string | null>(null);
  const [paired, setPaired] = useState<boolean>(false);
  const [claimInFlight, setClaimInFlight] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  // Resolve the local pod URL once on mount; we need it to know which
  // entry of `synap:pods` "this" Eve cares about.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/secrets-summary", {
          credentials: "include",
          cache: "no-store",
        });
        if (!res.ok) {
          // Secrets not readable — still try hostname inference.
          const inferred = inferPodUrlFromHostname();
          if (!cancelled) setCandidatePodUrl(inferred);
          return;
        }
        const data = (await res.json().catch(() => null)) as
          | { synap?: { apiUrl?: string | null } }
          | null;
        const url = data?.synap?.apiUrl ?? null;
        if (!cancelled) {
          setLocalPodUrl(url);
          setPaired(hasLocalPodSession(url));
          // When secrets don't have a configured pod URL, try to infer
          // one from the Eve hostname (eve.X → pod.X).
          if (!url) setCandidatePodUrl(inferPodUrlFromHostname());
        }
      } catch {
        const inferred = inferPodUrlFromHostname();
        if (!cancelled) setCandidatePodUrl(inferred);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Cross-tab listener — re-evaluate `paired` when `synap:pods` changes.
  useEffect(() => {
    if (typeof window === "undefined") return;
    function onStorage(e: StorageEvent) {
      if (e.key !== "synap:pods") return;
      setPaired(hasLocalPodSession(localPodUrl));
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [localPodUrl]);

  // ── Claim CTA handler — wired to `POST /api/pod/claim` ────────────────
  // CP-signed-in path: ask the dashboard to run the CP→pod handshake
  // chain and persist the resulting Kratos session. Then mirror it
  // into `synap:pods` so the gate state flips locally.
  const handleClaim = useCallback(async () => {
    if (claimInFlight) return;
    setClaimInFlight(true);
    setClaimError(null);
    // Pass the candidate pod URL when secrets don't have a configured URL.
    // The route validates it's HTTPS before using it.
    // Also send the in-memory CP token so the server doesn't need it on
    // disk — the disk sync happens async and may lag behind.
    const sharedSession = getSharedSession();
    const claimBody: Record<string, unknown> = {};
    if (candidatePodUrl && !localPodUrl) claimBody.podUrl = candidatePodUrl;
    if (sharedSession?.sessionToken) claimBody.cpToken = sharedSession.sessionToken;
    try {
      const res = await fetch("/api/pod/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(claimBody),
      });
      const data = (await res.json().catch(() => null)) as
        | {
            ok?: boolean;
            podUrl?: string;
            podSessionExpiresAt?: string;
            sessionToken?: string;
            error?: string;
            detail?: string;
            message?: string;
          }
        | null;
      if (!res.ok || !data?.ok) {
        const reason =
          data?.detail ||
          data?.message ||
          data?.error ||
          `Pod returned ${res.status}`;
        setClaimError(reason);
        addToast({
          title: "Couldn't claim this pod",
          description: reason,
          color: "danger",
        });
        return;
      }
      // Mirror into `synap:pods` so the gate flips without a refetch.
      // Use the real session token returned by the route — a blank
      // token would break other Synap surfaces that read synap:pods.
      const session = getSharedSession();
      if (data.podUrl && data.sessionToken && session) {
        storePodSession({
          podUrl: data.podUrl,
          sessionToken: data.sessionToken,
          userEmail: session.userName?.includes("@") ? session.userName : "",
          userId: session.userId,
        });
        if (!localPodUrl) setLocalPodUrl(data.podUrl);
      }
      setPaired(true);
      addToast({ title: "Pod claimed", color: "success" });
      refetch();
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Network error";
      setClaimError(reason);
      addToast({
        title: "Couldn't claim this pod",
        description: reason,
        color: "danger",
      });
    } finally {
      setClaimInFlight(false);
    }
  }, [claimInFlight, refetch, candidatePodUrl, localPodUrl]);

  // ── Already paired (Mode B or post-claim) → render OS ─────────────────
  if (paired) {
    return <>{children}</>;
  }

  // Legacy `mode: "self-hosted"` shared-session marker — still treated
  // as paired for back-compat with installs that pre-date the
  // orthogonal-layer refactor.
  const session = typeof window !== "undefined" ? getSharedSession() : null;
  if (session && isSelfHostedSession(session)) {
    return <>{children}</>;
  }

  // Loading the setup probe — render children optimistically so the
  // OS doesn't flicker during the initial fetch. Only "loading" gets
  // the optimistic pass; "ready" falls through so the claim CTA is
  // shown when the operator hasn't completed the CP→pod handshake yet.
  if (setupState === "loading") {
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
                setPaired(hasLocalPodSession(localPodUrl));
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
        defaultEmail={
          session?.userName?.includes("@") ? session.userName : undefined
        }
        onSuccess={(result) => {
          setClaim(result);
          // Refetch so the next mount of `useSetupStatus()` sees `ready`.
          refetch();
        }}
      />
    );
  }

  // CP-signed-in but local pod IS bootstrapped — operator just hasn't
  // run the CP handshake yet. Show the claim CTA without the
  // bootstrap email form (the pod doesn't need a new admin).
  if (session && !isSelfHostedSession(session)) {
    return (
      <ClaimExistingPodCard
        email={session.userName?.includes("@") ? session.userName : undefined}
        podUrl={localPodUrl ?? candidatePodUrl ?? undefined}
        onClaim={handleClaim}
        claimInFlight={claimInFlight}
        claimError={claimError}
      />
    );
  }

  // Unreachable / network error — let children render so the user can
  // open settings or retry; the home page surfaces its own banner.
  return <>{children}</>;
}

// ─── "Claim this pod" card (bootstrap-needed variant) ─────────────────────

interface ClaimPodCardProps {
  defaultEmail?: string;
  onSuccess: (result: SelfHostedClaimResult) => void;
}

function ClaimPodCard({
  defaultEmail,
  onSuccess,
}: ClaimPodCardProps) {
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

// ─── "Claim this pod" card (already-bootstrapped variant) ─────────────────
//
// CP user signed in, pod already has admin (so bootstrap-claim won't
// run), but `synap:pods` doesn't have an entry for the local pod yet
// — i.e. the user hasn't completed the CP→pod handshake on this
// browser. One-click CTA does that.

interface ClaimExistingPodCardProps {
  email?: string;
  /** The pod URL that will be claimed — shown to the user for confirmation. */
  podUrl?: string;
  onClaim: () => void;
  claimInFlight: boolean;
  claimError: string | null;
}

function ClaimExistingPodCard({
  email,
  podUrl,
  onClaim,
  claimInFlight,
  claimError,
}: ClaimExistingPodCardProps) {
  // Display just the hostname for readability (strip protocol + trailing slash).
  const podDisplay = podUrl
    ? podUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "")
    : null;

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
            <Plug className="h-5 w-5" strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-heading text-[20px] font-medium leading-tight tracking-tight text-foreground">
              Connect to your pod
            </h2>
            <p className="mt-1 text-[13px] leading-snug text-foreground/65">
              {email ? (
                <>
                  Sign{" "}
                  <span className="font-medium text-foreground">{email}</span>{" "}
                  into your pod via the Synap handshake.
                </>
              ) : (
                <>
                  Sign your Synap account into your pod via the handshake.
                </>
              )}
            </p>
          </div>
        </header>

        {podDisplay && (
          <div
            className="
              flex items-center gap-2.5
              rounded-lg
              bg-foreground/[0.03] ring-1 ring-inset ring-foreground/10
              px-3.5 py-2.5
            "
          >
            <Server
              className="h-3.5 w-3.5 shrink-0 text-foreground/55"
              strokeWidth={2}
              aria-hidden
            />
            <p className="min-w-0 truncate text-[12.5px] text-foreground/65">
              <span className="text-foreground/40">Pod detected: </span>
              <span className="font-medium text-foreground">{podDisplay}</span>
            </p>
          </div>
        )}

        {claimError && (
          <div
            role="alert"
            className="
              flex items-start gap-2 rounded-lg
              bg-warning/10 ring-1 ring-inset ring-warning/30
              px-3 py-2
            "
          >
            <p className="text-[12.5px] leading-snug text-foreground">
              {claimError}
            </p>
          </div>
        )}

        <Button
          color="primary"
          radius="md"
          size="md"
          isLoading={claimInFlight}
          onPress={onClaim}
          startContent={
            !claimInFlight ? <Plug className="h-3.5 w-3.5" /> : undefined
          }
          className="font-medium"
        >
          {claimInFlight ? "Claiming…" : "Claim this Eve as your pod"}
        </Button>

        {claimInFlight && (
          <div className="flex items-center justify-center gap-2 text-[12px] text-foreground/55">
            <Spinner size="sm" />
            <span>Running CP → pod handshake…</span>
          </div>
        )}
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
