"use client";

/**
 * `DeviceFlowModal` — UI for the RFC 8628 device-authorization flow.
 *
 * Shown when the operator clicks Sign in on a non-loopback Eve install
 * (custom domain, reverse proxy, NAT, headless server). Opens with a
 * spinner while the Eve server requests a fresh device_code, then
 * displays the human-readable user_code + verification URL.
 *
 * The actual polling happens in `startDeviceFlow()` from `cp-auth.ts`
 * — this component just renders the resulting state and dismisses
 * itself when the flow completes.
 *
 * UX:
 *   • Show the user_code in a large monospace pill, copy-on-click.
 *   • Show a "Open synap.live/device" button that opens in a new tab,
 *     pre-filling the code via the verification_uri_complete URL.
 *   • Live status: "Waiting for approval…" → green check on success.
 *   • Cancel button stops polling and closes.
 */

import { useEffect, useRef, useState } from "react";
import {
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
  Button, Chip,
} from "@heroui/react";
import {
  Smartphone, ExternalLink, Copy, Check, AlertTriangle, RefreshCw,
} from "lucide-react";
import {
  startDeviceFlow,
  type DeviceFlowController,
  type DeviceFlowState,
} from "../lib/cp-auth";

export interface DeviceFlowModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called when the device flow completes successfully (token persisted). */
  onApproved: () => void;
}

export function DeviceFlowModal({
  isOpen, onClose, onApproved,
}: DeviceFlowModalProps) {
  const [state, setState] = useState<DeviceFlowState>({ kind: "starting" });
  const [copied, setCopied] = useState(false);
  const controllerRef = useRef<DeviceFlowController | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, []);

  // Start the flow on open; cancel + reset on close.
  useEffect(() => {
    if (!isOpen) {
      controllerRef.current?.cancel();
      controllerRef.current = null;
      setState({ kind: "starting" });
      setCopied(false);
      return;
    }

    let active = true;
    void (async () => {
      const controller = await startDeviceFlow((next) => {
        if (!active) return;
        setState(next);
        if (next.kind === "approved") {
          // Small delay so the user sees the success state.
          closeTimerRef.current = window.setTimeout(() => {
            closeTimerRef.current = null;
            if (!active) return;
            onApproved();
            onClose();
          }, 800);
        }
      });
      controllerRef.current = controller;
    })();

    return () => {
      active = false;
      controllerRef.current?.cancel();
      controllerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const restart = () => {
    controllerRef.current?.cancel();
    setState({ kind: "starting" });
    setCopied(false);
    void (async () => {
      const controller = await startDeviceFlow((next) => {
        setState(next);
        if (next.kind === "approved") {
          closeTimerRef.current = window.setTimeout(() => {
            closeTimerRef.current = null;
            onApproved();
            onClose();
          }, 800);
        }
      });
      controllerRef.current = controller;
    })();
  };

  const copyCode = async () => {
    if (state.kind !== "awaiting-user") return;
    try {
      await navigator.clipboard.writeText(state.userCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard denied — silent */
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      placement="center"
      backdrop="blur"
      classNames={{
        base: "bg-content1/95 backdrop-blur-pane",
        header: "border-b border-foreground/[0.06]",
      }}
    >
      <ModalContent>
        {(closeFn) => (
          <>
            <ModalHeader className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Smartphone className="h-4 w-4 text-primary" strokeWidth={1.8} />
                <h2 className="text-[16px] font-medium text-foreground">
                  Sign in with a code
                </h2>
              </div>
              <p className="text-[12.5px] font-normal text-foreground/55">
                Eve is running at a remote address — visit Synap on any
                signed-in browser to approve.
              </p>
            </ModalHeader>
            <ModalBody className="py-6">
              {state.kind === "starting" && <StartingState />}
              {state.kind === "awaiting-user" && (
                <AwaitingState
                  userCode={state.userCode}
                  verificationUri={state.verificationUri}
                  verificationUriComplete={state.verificationUriComplete}
                  copied={copied}
                  onCopy={copyCode}
                />
              )}
              {state.kind === "approved" && <ApprovedState />}
              {state.kind === "denied" && (
                <FailureState
                  title="Sign-in denied"
                  message={state.message ?? "You denied access on Synap."}
                  onRetry={restart}
                />
              )}
              {state.kind === "expired" && (
                <FailureState
                  title="Code expired"
                  message={
                    state.message ??
                    "The code timed out before approval. Generate a new one."
                  }
                  onRetry={restart}
                />
              )}
              {state.kind === "error" && (
                <FailureState
                  title="Couldn't sign in"
                  message={state.message}
                  onRetry={restart}
                />
              )}
            </ModalBody>
            <ModalFooter className="border-t border-foreground/[0.06]">
              <Button variant="light" radius="full" onPress={closeFn}>
                {state.kind === "approved" ? "Close" : "Cancel"}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

// ─── Sub-states ──────────────────────────────────────────────────────────────

function StartingState() {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <Spinner />
      <p className="text-[13px] text-foreground/65">
        Generating a fresh code…
      </p>
    </div>
  );
}

function AwaitingState({
  userCode,
  verificationUri,
  verificationUriComplete,
  copied,
  onCopy,
}: {
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-5">
      {/* Code pill */}
      <button
        type="button"
        onClick={onCopy}
        aria-label={`Copy code ${userCode}`}
        className="
          group relative inline-flex items-center gap-3 rounded-xl
          bg-foreground/[0.05] border border-foreground/[0.10]
          px-6 py-4
          transition-colors duration-150
          hover:bg-foreground/[0.08]
          focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40
        "
      >
        <span
          className="
            font-mono font-medium tabular-nums
            text-[26px] tracking-[0.18em] text-foreground
          "
          style={{
            textShadow: "0 1px 2px rgba(0,0,0,0.35)",
          }}
        >
          {userCode}
        </span>
        <span className="text-foreground/55 group-hover:text-foreground/85">
          {copied ? (
            <Check className="h-4 w-4 text-success" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </span>
      </button>

      {/* Verification CTA */}
      <Button
        as="a"
        href={verificationUriComplete}
        target="_blank"
        rel="noreferrer"
        color="primary"
        radius="full"
        size="md"
        endContent={<ExternalLink className="h-3.5 w-3.5" />}
        className="font-medium"
      >
        Open Synap to approve
      </Button>

      <p className="text-center text-[12px] text-foreground/55 max-w-[400px] leading-relaxed">
        Or visit{" "}
        <code className="font-mono text-foreground/85">
          {new URL(verificationUri).host}/device
        </code>{" "}
        on any device where you're already signed into Synap and enter the
        code.
      </p>

      <Chip
        size="sm"
        radius="full"
        variant="flat"
        startContent={<Spinner small />}
      >
        Waiting for approval…
      </Chip>
    </div>
  );
}

function ApprovedState() {
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center">
      <div
        className="
          inline-flex h-12 w-12 items-center justify-center rounded-full
          bg-success/20 border border-success/30
        "
      >
        <Check className="h-6 w-6 text-success" strokeWidth={2.4} />
      </div>
      <h3 className="text-[15px] font-medium text-foreground">
        You're signed in
      </h3>
      <p className="text-[12.5px] text-foreground/65">
        Loading your apps from the marketplace…
      </p>
    </div>
  );
}

function FailureState({
  title, message, onRetry,
}: {
  title: string;
  message?: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center">
      <div
        className="
          inline-flex h-12 w-12 items-center justify-center rounded-full
          bg-warning/15 border border-warning/30
        "
      >
        <AlertTriangle className="h-6 w-6 text-warning" strokeWidth={2.2} />
      </div>
      <h3 className="text-[15px] font-medium text-foreground">{title}</h3>
      {message && (
        <p className="text-[12.5px] text-foreground/65 max-w-[360px]">
          {message}
        </p>
      )}
      <Button
        size="sm"
        radius="full"
        color="primary"
        variant="flat"
        startContent={<RefreshCw className="h-3.5 w-3.5" />}
        onPress={onRetry}
        className="mt-1"
      >
        Try again
      </Button>
    </div>
  );
}

// ─── Spinner — visionOS-style breathing dot ──────────────────────────────────

function Spinner({ small }: { small?: boolean } = {}) {
  return (
    <span
      className={
        "inline-block rounded-full bg-primary " +
        (small ? "h-1.5 w-1.5 mx-1" : "h-2.5 w-2.5")
      }
      style={{
        animation: "agent-pulse-dot 1.4s ease-in-out infinite",
        boxShadow: "0 0 8px rgba(52,211,153,0.55)",
      }}
      aria-hidden
    />
  );
}
