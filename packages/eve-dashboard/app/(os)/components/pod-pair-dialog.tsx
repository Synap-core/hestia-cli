"use client";

/**
 * `PodPairDialog` — modal that mints a `pod.userToken` via Eve's
 * JWT-Bearer exchange (`POST /api/auth/pod-signin`).
 *
 * Two flows depending on cached state from `usePodPairing()`:
 *
 *   1. Quick re-sign-in — `userEmail` cached. One button:
 *        [Sign in as alice@acme.com]
 *      (the operator already proved this email once; signing them back
 *      in is a single round-trip).
 *
 *   2. First sign-in — no email cached. Email input field + button.
 *      Same backing endpoint; the only difference is who supplies the
 *      email. Submitting a different email is also a valid path here
 *      (e.g. operator switched accounts on the pod).
 *
 * Failure handling: the pod's `/api/hub/auth/exchange` returns RFC 6749
 * `error` codes which our route preserves. We map them to actionable
 * copy:
 *
 *   • `user_not_found`     — email isn't a user on the pod yet. Hint
 *                            at `eve setup admin` or accepting an
 *                            invite first.
 *   • `invalid_client`     — Eve's issuer URL isn't trusted by the
 *                            pod. Surface the issuer URL (from
 *                            /api/pod/issuer-info) so the operator
 *                            can pass it to their pod admin.
 *   • `invalid_grant`      — the JWT was rejected (sig, exp, aud).
 *                            Usually means clock skew or a public-URL
 *                            mismatch — point at the issuer URL too.
 *   • Anything else        — generic upstream-status fallback, with
 *                            the description verbatim.
 *
 * Visual rules: HeroUI primitives only. Concentric radii. visionOS
 * material. No drop shadows. lucide-react icons.
 *
 * See:
 *   synap-team-docs/content/team/platform/eve-credentials.mdx §4
 *   synap-team-docs/content/team/platform/eve-os-home-design.mdx
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Input,
  Spinner,
  Chip,
  addToast,
} from "@heroui/react";
import { storePodSession } from "@synap-core/auth";
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  LogIn,
} from "lucide-react";

interface PodSigninSuccess {
  ok: true;
  role?: "owner" | "member";
  token?: string;
  expiresAt: string;
  user: { id: string; email: string; name: string | null };
  podUrl?: string;
}

interface PodSigninFailure {
  error?: string;
  message?: string;
  description?: string;
}

interface IssuerInfoResponse {
  issuerUrl: string | null;
  jwksUrl: string | null;
}

type DialogPhase =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; user: PodSigninSuccess["user"] }
  | { kind: "error"; code: string; message: string; status: number };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface PodPairDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Cached email — when present, dialog opens in "quick re-sign-in" mode. */
  defaultEmail?: string;
  /** Called after a successful mint so callers can refetch pairing state. */
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
  const [phase, setPhase] = useState<DialogPhase>({ kind: "idle" });
  const [issuerInfo, setIssuerInfo] = useState<IssuerInfoResponse | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  // Clear any pending close-timer on unmount to avoid calling onClose on
  // a component that is no longer mounted.
  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, []);

  // Reset state every time the dialog opens — modals are re-used by
  // the parent, so closing+reopening shouldn't carry stale errors.
  useEffect(() => {
    if (!isOpen) return;
    setEmail(defaultEmail ?? "");
    setPhase({ kind: "idle" });
  }, [isOpen, defaultEmail]);

  // Lazy-load issuer info only when we hit a relevant error (saves a
  // round-trip on the success path).
  useEffect(() => {
    if (
      phase.kind !== "error" ||
      (phase.code !== "invalid_client" && phase.code !== "invalid_grant")
    ) {
      return;
    }
    if (issuerInfo) return;
    let active = true;
    void (async () => {
      try {
        const res = await fetch("/api/pod/issuer-info", {
          credentials: "include",
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as IssuerInfoResponse;
        if (active) setIssuerInfo(data);
      } catch {
        /* silent — we'll just not show the hint chip */
      }
    })();
    return () => {
      active = false;
    };
  }, [phase, issuerInfo]);

  const trimmedEmail = email.trim();
  const emailValid = EMAIL_RE.test(trimmedEmail);

  const submitDisabled = useMemo(() => {
    if (phase.kind === "submitting") return true;
    if (!emailValid) return true;
    return false;
  }, [phase.kind, emailValid]);

  async function handleSubmit() {
    if (submitDisabled) return;
    setPhase({ kind: "submitting" });
    try {
      const res = await fetch("/api/auth/pod-signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        // First-write-wins ownership is decided server-side by
        // inspecting `~/.eve/secrets.json` — the browser doesn't pass
        // `cpToken` anymore. CP and pod auth are orthogonal layers.
        body: JSON.stringify({ email: trimmedEmail }),
      });
      const data = (await res.json().catch(() => null)) as
        | (Partial<PodSigninSuccess> & PodSigninFailure)
        | null;

      if (!res.ok || !data || !("ok" in data) || !data.ok) {
        const code =
          (data && typeof data.error === "string" && data.error) ||
          "exchange_failed";
        const message =
          (data && typeof data.description === "string" && data.description) ||
          (data && typeof data.message === "string" && data.message) ||
          "The pod rejected the sign-in.";
        setPhase({ kind: "error", code, message, status: res.status });
        return;
      }

      const success = data as PodSigninSuccess;

      // Persist into the cross-app `synap:pods` map so other Synap
      // surfaces on this domain pick it up automatically. The map is
      // independent of the CP `synap:session` cookie — pod state is
      // its own layer.
      try {
        // Pod URL — the pod-signin route doesn't echo it back today,
        // so we resolve it from `secrets-summary` (cheap, cached) when
        // missing. Failure here is non-fatal: the on-disk slot still
        // works for server-side proxying.
        let podUrl = success.podUrl;
        if (!podUrl) {
          const summary = await fetch("/api/secrets-summary", {
            credentials: "include",
            cache: "no-store",
          })
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null);
          podUrl =
            (summary as { synap?: { apiUrl?: string } } | null)?.synap
              ?.apiUrl ?? "";
        }
        if (podUrl && success.token) {
          storePodSession({
            podUrl,
            sessionToken: success.token,
            userEmail: success.user.email,
            userId: success.user.id,
          });
        }
      } catch {
        // Non-fatal — server-side disk slot is the authoritative
        // record for the host owner; member-mode browsers will retry
        // on next dialog open.
      }

      setPhase({ kind: "success", user: success.user });
      addToast({
        title: "Signed in to pod",
        description: success.user.email,
        color: "success",
      });
      onSuccess?.();
      // Brief pause so the operator sees the success state before the
      // dialog disappears.
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null;
        onClose();
      }, 700);
    } catch (err) {
      setPhase({
        kind: "error",
        code: "network",
        message:
          err instanceof Error
            ? err.message
            : "Couldn't reach Eve. Check your network.",
        status: 0,
      });
    }
  }

  const submitting = phase.kind === "submitting";
  const succeeded = phase.kind === "success";

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
                  ? "Eve remembers who you are — one click and you're back."
                  : "Eve signs in as you, not as itself. Use the email of a user on this pod."}
              </p>
            </ModalHeader>

            <ModalBody className="py-5">
              {succeeded ? (
                <SuccessState
                  email={
                    phase.kind === "success" ? phase.user.email : trimmedEmail
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
                  {isQuickMode ? (
                    <CachedEmailDisplay email={defaultEmail!} />
                  ) : (
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
                      autoFocus
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
                  )}

                  {phase.kind === "error" && (
                    <ErrorPanel
                      code={phase.code}
                      message={phase.message}
                      status={phase.status}
                      issuerInfo={issuerInfo}
                    />
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
                  {isQuickMode
                    ? `Sign in as ${defaultEmail}`
                    : "Sign in"}
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

function CachedEmailDisplay({ email }: { email: string }) {
  return (
    <div
      className="
        flex items-center gap-3
        rounded-lg
        bg-foreground/[0.04] ring-1 ring-inset ring-foreground/10
        px-3.5 py-3
      "
    >
      <span
        aria-hidden
        className="
          flex h-8 w-8 shrink-0 items-center justify-center
          rounded-md
          bg-primary/10 ring-1 ring-inset ring-primary/20
          text-primary
        "
      >
        <KeyRound className="h-4 w-4" strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] uppercase tracking-[0.04em] text-foreground/55">
          Pod account
        </p>
        <p className="mt-0.5 truncate text-[13.5px] font-medium text-foreground">
          {email}
        </p>
      </div>
    </div>
  );
}

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

function ErrorPanel({
  code,
  message,
  status,
  issuerInfo,
}: {
  code: string;
  message: string;
  status: number;
  issuerInfo: IssuerInfoResponse | null;
}) {
  const hint = mapErrorHint(code, status);
  return (
    <div
      role="alert"
      className="
        flex flex-col gap-2
        rounded-lg
        bg-warning/10 ring-1 ring-inset ring-warning/30
        px-3.5 py-3
      "
    >
      <div className="flex items-start gap-2">
        <AlertTriangle
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning"
          strokeWidth={2.2}
          aria-hidden
        />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[12.5px] font-medium text-foreground">
              {hint.title}
            </p>
            <Chip
              size="sm"
              radius="sm"
              variant="flat"
              className="font-mono text-[10.5px] uppercase tracking-wider"
            >
              {code}
            </Chip>
          </div>
          <p className="text-[12.5px] leading-snug text-foreground/65">
            {hint.description ?? message}
          </p>
        </div>
      </div>

      {(code === "invalid_client" || code === "invalid_grant") && (
        <IssuerHint issuerInfo={issuerInfo} />
      )}
    </div>
  );
}

function IssuerHint({
  issuerInfo,
}: {
  issuerInfo: IssuerInfoResponse | null;
}) {
  const [copied, setCopied] = useState<"issuer" | "jwks" | null>(null);

  async function copy(value: string, kind: "issuer" | "jwks") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      addToast({ title: "Copied", color: "success" });
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      addToast({ title: "Couldn't copy", color: "danger" });
    }
  }

  if (!issuerInfo?.issuerUrl) {
    return (
      <p className="text-[12px] leading-snug text-foreground/55">
        Tip: Eve doesn&apos;t have a public URL configured yet. Set one
        in <code className="font-mono text-foreground/85">~/.eve/secrets.json</code>{" "}
        (<code className="font-mono">dashboard.publicUrl</code>) so the
        pod can fetch JWKS from it.
      </p>
    );
  }

  return (
    <div className="space-y-1.5 pt-0.5">
      <p className="text-[11.5px] uppercase tracking-[0.04em] text-foreground/55">
        Send to your pod admin
      </p>
      <CopyChip
        label="Issuer"
        value={issuerInfo.issuerUrl}
        copied={copied === "issuer"}
        onCopy={() => void copy(issuerInfo.issuerUrl!, "issuer")}
      />
      {issuerInfo.jwksUrl && (
        <CopyChip
          label="JWKS"
          value={issuerInfo.jwksUrl}
          copied={copied === "jwks"}
          onCopy={() => void copy(issuerInfo.jwksUrl!, "jwks")}
          href={issuerInfo.jwksUrl}
        />
      )}
    </div>
  );
}

function CopyChip({
  label,
  value,
  copied,
  onCopy,
  href,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
  href?: string;
}) {
  return (
    <div
      className="
        flex items-center gap-2
        rounded-md
        bg-foreground/[0.05] ring-1 ring-inset ring-foreground/10
        px-2 py-1.5
      "
    >
      <span className="text-[10.5px] font-medium uppercase tracking-[0.04em] text-foreground/55 shrink-0">
        {label}
      </span>
      <code className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-foreground">
        {value}
      </code>
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="text-foreground/55 hover:text-foreground"
          aria-label={`Open ${label} in a new tab`}
        >
          <ExternalLink className="h-3 w-3" strokeWidth={2} />
        </a>
      )}
      <button
        type="button"
        onClick={onCopy}
        className="text-foreground/55 hover:text-foreground"
        aria-label={`Copy ${label} URL`}
      >
        {copied ? (
          <Check className="h-3 w-3 text-success" strokeWidth={2.2} />
        ) : (
          <Copy className="h-3 w-3" strokeWidth={2} />
        )}
      </button>
    </div>
  );
}

// ─── Error mapping ──────────────────────────────────────────────────────────

interface ErrorHint {
  title: string;
  description?: string;
}

function mapErrorHint(code: string, status: number): ErrorHint {
  switch (code) {
    case "user_not_found":
      return {
        title: "We don't have a user with that email",
        description:
          "This email isn't a user on the pod yet. Run `eve setup admin` from the host or accept an invite first, then come back.",
      };
    case "invalid_client":
      return {
        title: "Eve isn't a trusted issuer on this pod yet",
        description:
          "Ask your pod admin to approve Eve's issuer URL below — the pod fetches JWKS from there to verify Eve's signature.",
      };
    case "invalid_grant":
      return {
        title: "The pod rejected Eve's sign-in JWT",
        description:
          "Usually a public-URL mismatch or clock skew between Eve and the pod. Confirm Eve's issuer URL matches what the pod expects.",
      };
    case "invalid_request":
      return {
        title: "Bad request",
        description: "Eve sent a malformed sign-in request. This is a bug — please file an issue.",
      };
    case "no-pod-url":
      return {
        title: "No pod URL configured",
        description:
          "Eve doesn't know which pod to sign in to yet. Open Settings to point it at a pod first.",
      };
    case "no-eve-url":
      return {
        title: "Eve has no public URL",
        description:
          "The pod needs to fetch JWKS from a reachable Eve URL. Configure `dashboard.publicUrl` in `~/.eve/secrets.json` and retry.",
      };
    case "pod_unreachable":
      return {
        title: "Couldn't reach the pod",
        description:
          "Eve tried to talk to your pod but the request failed. Check the pod URL in Settings and your network.",
      };
    case "exchange_envelope_invalid":
      return {
        title: "Pod responded with an unexpected shape",
        description:
          "The pod accepted the sign-in but returned a malformed body. Check the pod logs.",
      };
    case "network":
      return {
        title: "Network error",
      };
    default:
      if (status === 401 || status === 403) {
        return {
          title: "Pod rejected the sign-in",
          description:
            "The pod returned an authorization error. Check the pod logs for details.",
        };
      }
      return { title: "Sign-in failed" };
  }
}
