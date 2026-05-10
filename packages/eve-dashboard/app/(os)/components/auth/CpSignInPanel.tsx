"use client";

/**
 * `CpSignInPanel` — Synap CP auth UI for Eve sign-in surfaces.
 *
 * Picks the right flow automatically:
 *
 *   Loopback (localhost / 127.x.x.x)
 *     → PKCE redirect. One button, navigates away to CP and returns
 *       via /auth/callback. Zero round-trips in the browser.
 *
 *   Anywhere else (custom domain, behind reverse proxy, NAT)
 *     → RFC 8628 device flow. Shows a short user_code; the operator
 *       approves on any signed-in browser at synap.live/device.
 *       No redirect URI needed — works for every deployment.
 *
 * After approval in either flow, `onSuccess` is called. The parent
 * (`EveSignInScreen`) passes this to `EveAccountGate.handleSuccess`
 * which re-resolves the gate state. `PodConnectGate` then handles
 * the CP→pod claim handshake.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Spinner } from "@heroui/react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { initiateCpOAuth } from "@/app/(os)/lib/cp-oauth";
import {
  resolveAuthMethod,
  startDeviceFlow,
  type DeviceFlowState,
} from "@/app/(os)/lib/cp-auth";

export interface CpSignInPanelProps {
  onSuccess?: () => void;
}

export function CpSignInPanel({ onSuccess }: CpSignInPanelProps) {
  const method = resolveAuthMethod();
  return method === "pkce-redirect" ? (
    <PkcePanel />
  ) : (
    <DeviceFlowPanel onSuccess={onSuccess} />
  );
}

// ─── PKCE (loopback) ─────────────────────────────────────────────────────────

function PkcePanel() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await initiateCpOAuth();
      // Navigation away — control never returns here.
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start sign-in.");
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {error && <InlineError message={error} />}
      <Button
        color="primary"
        radius="md"
        size="md"
        isLoading={busy}
        onPress={handleSignIn}
        endContent={!busy ? <ArrowRight className="h-3.5 w-3.5" /> : undefined}
        className="font-medium w-full"
      >
        Sign in with Synap
      </Button>
      <p className="text-center text-[11.5px] text-foreground/40">
        You'll be redirected to synap.live and back.
      </p>
    </div>
  );
}

// ─── Device flow (remote / custom domain) ────────────────────────────────────

function DeviceFlowPanel({ onSuccess }: { onSuccess?: () => void }) {
  const [flowState, setFlowState] = useState<DeviceFlowState | null>(null);
  const [copied, setCopied] = useState(false);
  const cancelRef = useRef<(() => void) | null>(null);

  const start = useCallback(async () => {
    setFlowState(null);
    const controller = await startDeviceFlow(setFlowState);
    cancelRef.current = controller.cancel;
  }, []);

  useEffect(() => {
    void start();
    return () => cancelRef.current?.();
  }, [start]);

  useEffect(() => {
    if (flowState?.kind === "approved") onSuccess?.();
  }, [flowState, onSuccess]);

  const handleCopy = (text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // ── Loading / starting ──────────────────────────────────────────────
  if (!flowState || flowState.kind === "starting") {
    return (
      <div className="flex items-center justify-center py-4">
        <Spinner size="sm" />
      </div>
    );
  }

  // ── Approved ────────────────────────────────────────────────────────
  if (flowState.kind === "approved") {
    return (
      <div className="flex flex-col items-center gap-2 py-2 text-center">
        <CheckCircle2 className="h-8 w-8 text-success" strokeWidth={1.8} />
        <p className="text-[13px] font-medium text-foreground">Signed in!</p>
        <p className="text-[12px] text-foreground/55">Setting up your workspace…</p>
      </div>
    );
  }

  // ── Expired / denied / error ────────────────────────────────────────
  if (
    flowState.kind === "expired" ||
    flowState.kind === "denied" ||
    flowState.kind === "error"
  ) {
    return (
      <div className="flex flex-col gap-3">
        <InlineError
          message={
            flowState.kind === "expired"
              ? "Code expired before approval."
              : flowState.kind === "denied"
                ? "Sign-in was denied."
                : (flowState.message ?? "Something went wrong.")
          }
        />
        <Button
          variant="flat"
          radius="md"
          size="md"
          onPress={start}
          startContent={<RefreshCw className="h-3.5 w-3.5" />}
          className="font-medium w-full"
        >
          Try again
        </Button>
      </div>
    );
  }

  // ── Awaiting user approval ──────────────────────────────────────────
  const { userCode, verificationUri } = flowState;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-[12.5px] text-foreground/65">
          Open this URL on any signed-in browser:
        </p>
        <a
          href={verificationUri}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[12.5px] font-medium text-primary hover:underline"
        >
          {verificationUri}
          <ExternalLink className="h-3 w-3" strokeWidth={2} />
        </a>
        <p className="text-[12px] text-foreground/55">then enter this code:</p>
        <button
          type="button"
          onClick={() => handleCopy(userCode)}
          className="
            group rounded-xl
            bg-foreground/[0.06] ring-1 ring-inset ring-foreground/10
            px-6 py-3
            font-mono text-[28px] font-semibold tracking-[0.25em] text-foreground
            hover:bg-foreground/[0.09] transition-colors
            select-all
          "
          title={copied ? "Copied!" : "Click to copy"}
          aria-label="Copy device code"
        >
          {userCode}
        </button>
        <p className="text-[11.5px] text-foreground/40">
          {copied ? "Copied to clipboard" : "Click to copy · Waiting for approval…"}
        </p>
      </div>

      <div className="flex items-center justify-center gap-1.5 text-foreground/40">
        <Spinner size="sm" color="current" />
        <span className="text-[12px]">Waiting for approval</span>
      </div>

      <Button
        variant="light"
        radius="md"
        size="sm"
        onPress={() => { cancelRef.current?.(); setFlowState(null); void start(); }}
        className="text-foreground/45 hover:text-foreground text-[12px]"
      >
        Restart
      </Button>
    </div>
  );
}

// ─── Shared ───────────────────────────────────────────────────────────────────

function InlineError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg bg-danger/10 ring-1 ring-inset ring-danger/30 px-3 py-2"
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" strokeWidth={2.2} aria-hidden />
      <p className="text-[12.5px] leading-snug text-foreground">{message}</p>
    </div>
  );
}
