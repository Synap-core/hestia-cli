"use client";

/**
 * /setup/pair-pod — First-launch pod pairing wizard.
 *
 * The auth callback redirects here when the user just signed in to Synap CP
 * and no pod is paired yet (`/api/pod/pairing-status` returns anything other
 * than "paired" or "needs-refresh").
 *
 * Returning users (already paired) are bounced back to `/` on mount.
 *
 * Flow:
 *   1. Fetch the user's pods from CP via GET /api/auth/cp/pods.
 *   2. Show pods as selectable cards; each "Connect" CTA calls
 *      POST /api/pod/claim with that pod's URL.
 *   3. On success → redirect to /.
 *   4. If the user has no pods yet → offer "Create a free pod" link.
 *
 * See: synap-team-docs/content/team/platform/eve-os-roadmap.mdx §2.1
 */

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Spinner } from "@heroui/react";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Plus,
  Server,
} from "lucide-react";
import { Wordmark } from "../../components/wordmark";
import { getSharedSession, storePodSession } from "@/lib/synap-auth";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CpPod {
  id: string;
  name?: string;
  url?: string;
  podUrl?: string;
}

interface CpPodsPayload {
  data?: CpPod[];
  pods?: CpPod[];
}

interface ClaimResponse {
  ok?: boolean;
  podUrl?: string;
  sessionToken?: string;
  error?: string;
  detail?: string;
  message?: string;
}

type Phase =
  | { kind: "loading" }
  | { kind: "selecting"; pods: CpPod[] }
  | { kind: "claiming"; podUrl: string }
  | { kind: "success"; podUrl: string }
  | { kind: "error"; message: string };

// ─── CP pods helper ───────────────────────────────────────────────────────────

async function fetchCpPods(): Promise<CpPod[]> {
  try {
    const res = await fetch("/api/auth/cp/pods", {
      credentials: "include",
      cache: "no-store",
    });
    if (!res.ok) return [];
    const raw = (await res.json().catch(() => null)) as
      | CpPodsPayload
      | CpPod[]
      | null;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    const list = raw.data ?? raw.pods;
    if (Array.isArray(list)) return list;
    return [];
  } catch {
    return [];
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PairPodPage() {
  return (
    <Suspense fallback={<PageShell><LoadingCard /></PageShell>}>
      <PairPodInner />
    </Suspense>
  );
}

function PairPodInner() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const ranRef = useRef(false);

  const init = useCallback(async () => {
    // Already paired? Skip straight to the OS.
    try {
      const res = await fetch("/api/pod/pairing-status", {
        credentials: "include",
        cache: "no-store",
      });
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { state: string }
          | null;
        if (data?.state === "paired" || data?.state === "needs-refresh") {
          router.replace("/");
          return;
        }
      }
    } catch {
      // Can't check — proceed to selection.
    }

    const pods = await fetchCpPods();
    setPhase({ kind: "selecting", pods });
  }, [router]);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    void init();
  }, [init]);

  async function handleClaim(podUrl: string) {
    setPhase({ kind: "claiming", podUrl });
    try {
      const sharedSession =
        typeof window !== "undefined" ? getSharedSession() : null;
      const body: Record<string, unknown> = { podUrl };
      if (sharedSession?.sessionToken) body.cpToken = sharedSession.sessionToken;

      const res = await fetch("/api/pod/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as ClaimResponse | null;

      if (!res.ok || !data?.ok) {
        setPhase({ kind: "error", message: mapClaimError(data?.error, data?.detail ?? data?.message) });
        return;
      }

      // Mirror into synap:pods so other Synap surfaces on this domain see it.
      if (data.podUrl && data.sessionToken && sharedSession) {
        storePodSession({
          podUrl: data.podUrl,
          sessionToken: data.sessionToken,
          userEmail: sharedSession.userName?.includes("@")
            ? sharedSession.userName
            : "",
          userId: sharedSession.userId,
        });
      }

      setPhase({ kind: "success", podUrl: data.podUrl ?? podUrl });
      setTimeout(() => router.replace("/"), 900);
    } catch (err) {
      setPhase({
        kind: "error",
        message:
          err instanceof Error
            ? err.message
            : "Couldn't reach the dashboard API.",
      });
    }
  }

  function handleRetry() {
    ranRef.current = false;
    setPhase({ kind: "loading" });
    void init();
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (phase.kind === "loading") {
    return (
      <PageShell>
        <LoadingCard />
      </PageShell>
    );
  }

  if (phase.kind === "claiming") {
    const display = stripProtocol(phase.podUrl);
    return (
      <PageShell>
        <StatusCard
          icon={<Spinner size="sm" color="primary" />}
          title="Connecting your pod…"
          body={`Completing the handshake with ${display}.`}
        />
      </PageShell>
    );
  }

  if (phase.kind === "success") {
    const display = stripProtocol(phase.podUrl);
    return (
      <PageShell>
        <StatusCard
          icon={<CheckCircle2 className="h-5 w-5 text-success" />}
          title="Pod connected"
          body={`Signing you into Eve with ${display}…`}
        />
      </PageShell>
    );
  }

  if (phase.kind === "error") {
    return (
      <PageShell>
        <div className="w-full max-w-md rounded-2xl border border-divider bg-content1 p-8 space-y-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
            <div className="flex-1 min-w-0">
              <h1 className="font-heading text-lg font-medium tracking-tightest text-foreground">
                Couldn&apos;t connect your pod
              </h1>
              <p className="mt-1 text-sm text-default-500 break-words">
                {phase.message}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button color="primary" size="sm" radius="md" onPress={handleRetry}>
              Try again
            </Button>
            <Button
              variant="bordered"
              size="sm"
              radius="md"
              onPress={() => router.replace("/")}
            >
              Skip for now
            </Button>
          </div>
        </div>
      </PageShell>
    );
  }

  // Selecting phase
  const { pods } = phase;

  return (
    <PageShell>
      <div className="w-full max-w-md space-y-5">
        {/* Header */}
        <div className="flex flex-col items-center gap-3 text-center">
          <span
            aria-hidden
            className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-inset ring-primary/20 text-primary"
          >
            <Server className="h-6 w-6" strokeWidth={1.8} />
          </span>
          <h1 className="font-heading text-[24px] font-medium leading-tight tracking-tight text-foreground">
            Connect your pod
          </h1>
          <p className="text-[13px] text-foreground/55 max-w-[22rem]">
            Your Synap pod is your personal data layer. Pick one to connect
            to Eve, or create a new one.
          </p>
        </div>

        {/* Pod list + create */}
        <div className="rounded-2xl border border-divider bg-content1 p-5 sm:p-6 space-y-3">
          {pods.length > 0 && (
            <>
              <p className="text-[11px] uppercase tracking-[0.06em] font-medium text-foreground/40 mb-1">
                Your pods
              </p>
              {pods.map((pod) => {
                const podUrl = pod.url ?? pod.podUrl ?? "";
                const display = podUrl ? stripProtocol(podUrl) : pod.id;
                return (
                  <PodCard
                    key={pod.id}
                    name={pod.name ?? display}
                    display={podUrl ? display : ""}
                    onConnect={() => void handleClaim(podUrl)}
                  />
                );
              })}
              <div className="border-t border-divider/60 my-1" />
            </>
          )}

          {/* Create a free pod */}
          <a
            href="https://synap.live"
            target="_blank"
            rel="noreferrer"
            className="
              flex items-center justify-between gap-3
              rounded-lg
              bg-foreground/[0.03] ring-1 ring-inset ring-foreground/8
              px-3.5 py-3
              hover:bg-foreground/[0.06] transition-colors
              group
            "
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 ring-1 ring-inset ring-primary/20 text-primary">
                <Plus className="h-4 w-4" strokeWidth={2} />
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-foreground">
                  Create a free pod
                </p>
                <p className="text-[11.5px] text-foreground/50">
                  Hosted on synap.live
                </p>
              </div>
            </div>
            <ExternalLink
              className="h-3.5 w-3.5 shrink-0 text-foreground/35 group-hover:text-foreground/60 transition-colors"
              strokeWidth={2}
              aria-hidden
            />
          </a>

          <Button
            variant="light"
            size="sm"
            radius="md"
            className="w-full text-foreground/40 text-[12px]"
            onPress={() => router.replace("/")}
          >
            Skip for now
          </Button>
        </div>
      </div>
    </PageShell>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="flex items-center px-6 py-5">
        <Wordmark size="md" />
      </header>
      <main className="flex-1 flex items-center justify-center px-4 pb-20">
        {children}
      </main>
    </div>
  );
}

function LoadingCard() {
  return (
    <StatusCard
      icon={<Spinner size="sm" color="primary" />}
      title="Checking your account…"
      body=""
    />
  );
}

function StatusCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="w-full max-w-md rounded-2xl border border-divider bg-content1 p-8">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0">{icon}</span>
        <div className="flex-1 min-w-0">
          <h1 className="font-heading text-lg font-medium tracking-tightest text-foreground">
            {title}
          </h1>
          {body && (
            <p className="mt-1 text-sm text-default-500">{body}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function PodCard({
  name,
  display,
  onConnect,
}: {
  name: string;
  display: string;
  onConnect: () => void;
}) {
  return (
    <div
      className="
        flex items-center gap-3
        rounded-lg
        bg-foreground/[0.03] ring-1 ring-inset ring-foreground/10
        px-3.5 py-3
      "
    >
      <span
        aria-hidden
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-foreground/[0.06] ring-1 ring-inset ring-foreground/10 text-foreground/55"
      >
        <Server className="h-4 w-4" strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-foreground">
          {name}
        </p>
        {display && (
          <p className="truncate text-[11.5px] text-foreground/50">{display}</p>
        )}
      </div>
      <Button
        color="primary"
        size="sm"
        radius="md"
        onPress={onConnect}
        className="shrink-0 font-medium"
      >
        Connect
      </Button>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stripProtocol(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function mapClaimError(
  code: string | undefined | null,
  detail: string | undefined | null,
): string {
  if (!code) return detail ?? "The connection failed. Please try again.";
  switch (code) {
    case "handshake-failed":
      return (
        detail ??
        "The handshake with your pod failed. Make sure the pod is running and reachable."
      );
    case "pod-exchange-failed":
      return detail ?? "The pod rejected the connection. Check the pod logs.";
    case "cp-session-required":
      return "Your Synap session expired. Go back and sign in again.";
    case "pod-url-not-configured":
      return (
        detail ??
        "No pod URL is configured. Open Settings to point Eve at a pod first."
      );
    default:
      return detail ?? `Connection failed (${code}). Please try again.`;
  }
}
