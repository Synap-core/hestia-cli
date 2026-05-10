"use client";

/**
 * `PodPairDialog` — modal that signs the operator into the pod via the
 * pod's Kratos self-service login (`POST /api/pod/kratos-auth`).
 *
 * The route sets the parent-domain `ory_kratos_session` cookie on
 * success, which Eve's `/api/pod/*` proxy and any sibling Synap surface
 * (pod-admin, pod itself) consume directly. Eve persists nothing.
 *
 * Two flows depending on cached state from `usePodPairing()`:
 *
 *   1. Quick re-sign-in — `userEmail` cached. Email pre-filled, password
 *      requested.
 *   2. First sign-in — no email cached. Email + password fields.
 *
 * Failure handling: surface Kratos' validation messages verbatim
 * (already humanized inside `eve-kratos-client`).
 *
 * See:
 *   synap-team-docs/content/team/platform/eve-credentials.mdx
 *   synap-team-docs/content/team/platform/eve-os-home-design.mdx
 */

import { useEffect, useRef, useState } from "react";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Input,
  addToast,
} from "@heroui/react";
import { storePodSession } from "@synap-core/auth";
import {
  AlertTriangle,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  LogIn,
} from "lucide-react";

interface KratosAuthSuccess {
  ok: true;
  sessionToken?: string;
  expiresAt?: string;
  podUrl?: string;
  user?: { id: string; email: string; name: string };
}

interface KratosAuthFailure {
  error?: string;
  messages?: string[];
  detail?: string;
}

type DialogPhase =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; email: string }
  | { kind: "error"; message: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface PodPairDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Cached email — when present, the form pre-fills it. */
  defaultEmail?: string;
  /** Called after a successful sign-in so callers can refetch pairing state. */
  onSuccess?: () => void;
}

export function PodPairDialog({
  isOpen,
  onClose,
  defaultEmail,
  onSuccess,
}: PodPairDialogProps) {
  const isQuickMode = !!defaultEmail;
  const [email, setEmail] = useState<string>(defaultEmail ?? "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [phase, setPhase] = useState<DialogPhase>({ kind: "idle" });
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setEmail(defaultEmail ?? "");
    setPassword("");
    setShowPassword(false);
    setPhase({ kind: "idle" });
  }, [isOpen, defaultEmail]);

  const trimmedEmail = email.trim();
  const emailValid = EMAIL_RE.test(trimmedEmail);
  const submitting = phase.kind === "submitting";
  const succeeded = phase.kind === "success";
  const submitDisabled = submitting || !emailValid || !password;

  async function handleSubmit() {
    if (submitDisabled) return;
    setPhase({ kind: "submitting" });
    try {
      const res = await fetch("/api/pod/kratos-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          mode: "login",
          email: trimmedEmail,
          password,
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | (KratosAuthSuccess & KratosAuthFailure)
        | null;

      if (!res.ok || !data?.ok) {
        const message =
          data?.messages?.join(" ") ??
          data?.detail ??
          (data?.error ? `Sign-in failed (${data.error}).` : "The pod rejected the sign-in.");
        setPhase({ kind: "error", message });
        return;
      }

      const success = data as KratosAuthSuccess;

      // Mirror into the cross-app `synap:pods` map so other Synap
      // surfaces on this domain pick it up. The Kratos cookie is
      // already set at the parent domain by the route.
      if (success.podUrl && success.sessionToken) {
        try {
          storePodSession({
            podUrl: success.podUrl,
            sessionToken: success.sessionToken,
            userEmail: success.user?.email ?? trimmedEmail,
            userId: success.user?.id ?? "",
          });
        } catch {
          /* non-fatal — server-side cookie is the authoritative record. */
        }
      }

      setPhase({ kind: "success", email: success.user?.email ?? trimmedEmail });
      addToast({
        title: "Signed in to pod",
        description: success.user?.email ?? trimmedEmail,
        color: "success",
      });
      onSuccess?.();
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null;
        onClose();
      }, 700);
    } catch (err) {
      setPhase({
        kind: "error",
        message:
          err instanceof Error
            ? err.message
            : "Couldn't reach Eve. Check your network.",
      });
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="md"
      placement="center"
      backdrop="blur"
      isDismissable={!submitting}
      classNames={{
        base: "bg-content1/95 backdrop-blur-pane",
        header: "border-b border-foreground/[0.06]",
        footer: "border-t border-foreground/[0.06]",
      }}
    >
      <ModalContent>
        {(closeFn) => (
          <>
            <ModalHeader className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <KeyRound
                  className="h-4 w-4 text-primary"
                  strokeWidth={1.8}
                  aria-hidden
                />
                <h2 className="text-[16px] font-medium text-foreground">
                  {isQuickMode ? "Sign back in to your pod" : "Sign in to your pod"}
                </h2>
              </div>
              <p className="text-[12.5px] font-normal text-foreground/55">
                {isQuickMode
                  ? "Eve remembers your email — enter your password to continue."
                  : "Eve signs in as you, not as itself. Use the credentials of a user on this pod."}
              </p>
            </ModalHeader>

            <ModalBody className="py-5">
              {succeeded ? (
                <SuccessState
                  email={
                    phase.kind === "success" ? phase.email : trimmedEmail
                  }
                />
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void handleSubmit();
                  }}
                  className="flex flex-col gap-4"
                  noValidate
                >
                  <Input
                    type="email"
                    size="md"
                    radius="md"
                    variant="flat"
                    label="Email"
                    labelPlacement="outside"
                    placeholder="you@yourdomain.com"
                    value={email}
                    onValueChange={setEmail}
                    autoComplete="email"
                    autoFocus={!isQuickMode}
                    isRequired
                    isInvalid={email.length > 0 && !emailValid}
                    errorMessage={
                      email.length > 0 && !emailValid
                        ? "Enter a valid email address."
                        : undefined
                    }
                    spellCheck="false"
                    isDisabled={submitting}
                  />
                  <Input
                    type={showPassword ? "text" : "password"}
                    size="md"
                    radius="md"
                    variant="flat"
                    label="Password"
                    labelPlacement="outside"
                    value={password}
                    onValueChange={setPassword}
                    autoComplete="current-password"
                    autoFocus={isQuickMode}
                    isRequired
                    isDisabled={submitting}
                    endContent={
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        className="shrink-0 text-foreground/40 hover:text-foreground/70 transition-colors"
                        aria-label={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    }
                  />

                  {phase.kind === "error" && (
                    <ErrorPanel message={phase.message} />
                  )}
                </form>
              )}
            </ModalBody>

            <ModalFooter>
              <Button
                variant="light"
                radius="full"
                size="sm"
                onPress={closeFn}
                isDisabled={submitting}
              >
                {succeeded ? "Close" : "Cancel"}
              </Button>
              {!succeeded && (
                <Button
                  type="button"
                  color="primary"
                  radius="md"
                  size="md"
                  startContent={
                    !submitting ? (
                      <LogIn className="h-3.5 w-3.5" />
                    ) : undefined
                  }
                  isLoading={submitting}
                  isDisabled={submitDisabled}
                  onPress={() => void handleSubmit()}
                  className="font-medium"
                >
                  Sign in
                </Button>
              )}
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SuccessState({ email }: { email: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-4 text-center">
      <div
        className="
          inline-flex h-12 w-12 items-center justify-center rounded-full
          bg-success/15 ring-1 ring-inset ring-success/30
        "
        aria-hidden
      >
        <Check className="h-6 w-6 text-success" strokeWidth={2.4} />
      </div>
      <h3 className="text-[15px] font-medium text-foreground">
        You&apos;re signed in
      </h3>
      <p className="text-[12.5px] text-foreground/65">
        Eve is now acting as{" "}
        <span className="font-medium text-foreground">{email}</span> on
        your pod.
      </p>
    </div>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="
        flex items-start gap-2
        rounded-lg
        bg-warning/10 ring-1 ring-inset ring-warning/30
        px-3.5 py-3
      "
    >
      <AlertTriangle
        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning"
        strokeWidth={2.2}
        aria-hidden
      />
      <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-foreground/65">
        {message}
      </p>
    </div>
  );
}
