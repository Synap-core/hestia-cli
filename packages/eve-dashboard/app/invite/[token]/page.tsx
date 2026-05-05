"use client";

/**
 * `/invite/[token]` — public invite landing page.
 *
 * The invitee opens this URL after the admin shares it. They don't have
 * an Eve session and they don't have a pod account yet. The page:
 *
 *   1. Looks up invite metadata via `GET /api/invite/[token]` (no auth).
 *   2. Shows the canonical email locked into the form (security: the
 *      invitee MUST sign up with the address the admin invited).
 *   3. Collects name + password locally for UX continuity, then POSTs
 *      to `/api/invite/[token]/accept` and redirects the browser to
 *      the pod's Kratos signup URL with the invite token.
 *
 * Path (b) from the architecture: Eve does NOT call any pod tRPC
 * mutations here. The pod owns Kratos signup; the invite is consumed
 * atomically when the pod's signup flow completes. Mirrors Phase 5
 * `bootstrap-admin-card.tsx` in shape and visual language.
 *
 * Lives outside the `(os)` group on purpose: no shell, no dock — just
 * a centred card. Clean signup affordance.
 *
 * See: synap-team-docs/content/team/platform/eve-credentials.mdx §6
 */

import { useEffect, useMemo, useState, use } from "react";
import {
  Button,
  Card,
  Input,
  Spinner,
  addToast,
} from "@heroui/react";
import {
  KeyRound,
  Check,
  ExternalLink,
  AlertTriangle,
  UserPlus,
} from "lucide-react";

interface InviteLookupOk {
  valid: true;
  email: string;
  role: string;
  type: "workspace" | "pod";
  workspaceName: string | null;
  expiresAt: string | null;
}
interface InviteLookupBad {
  valid: false;
  reason: "expired" | "not-found" | "unreachable" | "no-pod-url";
}
type InviteLookup = InviteLookupOk | InviteLookupBad;

type Phase =
  | { kind: "loading" }
  | { kind: "invalid"; reason: InviteLookupBad["reason"] }
  | { kind: "ready"; invite: InviteLookupOk }
  | { kind: "submitting"; invite: InviteLookupOk }
  | { kind: "success"; signupUrl: string }
  | { kind: "redirecting"; signupUrl: string }
  | { kind: "error"; message: string; invite: InviteLookupOk };

interface PageProps {
  params: Promise<{ token: string }>;
}

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export default function InvitePage({ params }: PageProps) {
  const { token } = use(params);

  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  // Lookup invite metadata on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/invite/${encodeURIComponent(token)}`, {
          cache: "no-store",
        });
        const data = (await r.json().catch(() => null)) as InviteLookup | null;
        if (cancelled) return;
        if (!data || !("valid" in data)) {
          setPhase({ kind: "invalid", reason: "unreachable" });
          return;
        }
        if (data.valid) {
          setPhase({ kind: "ready", invite: data });
        } else {
          setPhase({ kind: "invalid", reason: data.reason });
        }
      } catch {
        if (cancelled) return;
        setPhase({ kind: "invalid", reason: "unreachable" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const passwordMismatch = useMemo(
    () =>
      confirm.length > 0 && password.length > 0 && password !== confirm,
    [password, confirm],
  );
  const passwordTooShort = useMemo(
    () => password.length > 0 && password.length < 8,
    [password],
  );

  async function handleAccept() {
    if (phase.kind !== "ready") return;
    const invite = phase.invite;
    if (passwordMismatch || passwordTooShort) return;
    if (password.length === 0) {
      setPhase({
        kind: "error",
        message: "Choose a password.",
        invite,
      });
      return;
    }
    setPhase({ kind: "submitting", invite });
    try {
      const r = await fetch(
        `/api/invite/${encodeURIComponent(token)}/accept`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: invite.email }),
        },
      );
      const data = (await r.json().catch(() => null)) as
        | { signupUrl?: string; error?: string }
        | null;
      if (!r.ok || !data?.signupUrl) {
        setPhase({
          kind: "error",
          invite,
          message:
            (data && data.error) ||
            "Couldn't continue with the invite. Try again.",
        });
        return;
      }
      setPhase({ kind: "success", signupUrl: data.signupUrl });
      // Brief pause so the user sees the confirmation card.
      window.setTimeout(() => {
        setPhase({ kind: "redirecting", signupUrl: data.signupUrl! });
        window.location.assign(data.signupUrl!);
      }, 800);
    } catch (err) {
      setPhase({
        kind: "error",
        invite,
        message:
          err instanceof Error ? err.message : "Network error.",
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <Card
        isBlurred
        shadow="none"
        radius="md"
        className="
          flex w-full max-w-[480px] flex-col gap-5 p-6 sm:p-7
          bg-foreground/[0.04]
          ring-1 ring-inset ring-foreground/10
        "
      >
        {phase.kind === "loading" && <LoadingState />}

        {phase.kind === "invalid" && (
          <InvalidState reason={phase.reason} />
        )}

        {(phase.kind === "ready" ||
          phase.kind === "submitting" ||
          phase.kind === "error") && (
          <ReadyState
            invite={phase.kind === "error" ? phase.invite : phase.invite}
            name={name}
            password={password}
            confirm={confirm}
            onName={setName}
            onPassword={setPassword}
            onConfirm={setConfirm}
            submitting={phase.kind === "submitting"}
            errorMessage={
              phase.kind === "error" ? phase.message : null
            }
            passwordMismatch={passwordMismatch}
            passwordTooShort={passwordTooShort}
            onSubmit={() => void handleAccept()}
          />
        )}

        {(phase.kind === "success" || phase.kind === "redirecting") && (
          <SuccessState
            signupUrl={phase.signupUrl}
            redirecting={phase.kind === "redirecting"}
          />
        )}
      </Card>
    </div>
  );
}

// ─── States ──────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center">
      <Spinner size="md" color="primary" />
      <p className="text-[13px] text-foreground/65">
        Looking up invite…
      </p>
    </div>
  );
}

function InvalidState({
  reason,
}: {
  reason: InviteLookupBad["reason"];
}) {
  const copy = (() => {
    switch (reason) {
      case "expired":
        return {
          title: "This invite has expired",
          body: "Ask the admin to send you a fresh link.",
        };
      case "not-found":
        return {
          title: "This invite is no longer valid",
          body: "It may have been used already, or the link is mistyped.",
        };
      case "no-pod-url":
        return {
          title: "Pod not configured",
          body: "This Eve hasn't been pointed at a pod yet. Contact the admin.",
        };
      default:
        return {
          title: "Couldn't reach the pod",
          body: "Try again in a moment, or ask the admin to verify the link.",
        };
    }
  })();
  return (
    <>
      <header className="flex items-start gap-3">
        <span
          aria-hidden
          className="
            flex h-10 w-10 shrink-0 items-center justify-center
            rounded-lg
            bg-warning/10
            ring-1 ring-inset ring-warning/20
            text-warning
          "
        >
          <AlertTriangle className="h-5 w-5" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-[20px] font-medium leading-tight tracking-tight text-foreground">
            {copy.title}
          </h2>
          <p className="mt-1 text-[13px] leading-snug text-foreground/65">
            {copy.body}
          </p>
        </div>
      </header>
      <div className="flex justify-end">
        <Button
          as="a"
          href="https://synap.live"
          target="_blank"
          rel="noreferrer"
          variant="light"
          size="sm"
          radius="md"
          endContent={<ExternalLink className="h-3.5 w-3.5" />}
          className="text-foreground/65 hover:text-foreground"
        >
          Open synap.live
        </Button>
      </div>
    </>
  );
}

function ReadyState({
  invite,
  name,
  password,
  confirm,
  onName,
  onPassword,
  onConfirm,
  submitting,
  errorMessage,
  passwordMismatch,
  passwordTooShort,
  onSubmit,
}: {
  invite: InviteLookupOk;
  name: string;
  password: string;
  confirm: string;
  onName: (v: string) => void;
  onPassword: (v: string) => void;
  onConfirm: (v: string) => void;
  submitting: boolean;
  errorMessage: string | null;
  passwordMismatch: boolean;
  passwordTooShort: boolean;
  onSubmit: () => void;
}) {
  const heading =
    invite.type === "workspace"
      ? `You've been invited to ${invite.workspaceName ?? "a workspace"}`
      : "You've been invited to this pod";
  const subline =
    invite.type === "workspace"
      ? `Sign up to join as ${invite.role}.`
      : `Sign up to join the pod as ${invite.role}.`;

  return (
    <>
      <header className="flex items-start gap-3">
        <span
          aria-hidden
          className="
            flex h-10 w-10 shrink-0 items-center justify-center
            rounded-lg
            bg-primary/10
            ring-1 ring-inset ring-primary/20
            text-primary
          "
        >
          <UserPlus className="h-5 w-5" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-[20px] font-medium leading-tight tracking-tight text-foreground">
            {heading}
          </h2>
          <p className="mt-1 text-[13px] leading-snug text-foreground/65">
            {subline}
          </p>
        </div>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!submitting) onSubmit();
        }}
        className="flex flex-col gap-3"
        noValidate
      >
        <Input
          type="email"
          size="md"
          radius="md"
          variant="flat"
          label="Email"
          labelPlacement="outside"
          value={invite.email}
          isDisabled
          isReadOnly
          autoComplete="email"
          description="The invite is locked to this email."
        />

        <Input
          size="md"
          radius="md"
          variant="flat"
          label="Name"
          labelPlacement="outside"
          placeholder="Optional"
          value={name}
          onValueChange={onName}
          autoComplete="name"
          spellCheck="false"
          isDisabled={submitting}
        />

        <Input
          type="password"
          size="md"
          radius="md"
          variant="flat"
          label="Password"
          labelPlacement="outside"
          placeholder="At least 8 characters"
          value={password}
          onValueChange={onPassword}
          autoComplete="new-password"
          isRequired
          isInvalid={passwordTooShort}
          errorMessage={
            passwordTooShort
              ? "Use at least 8 characters."
              : undefined
          }
          isDisabled={submitting}
        />

        <Input
          type="password"
          size="md"
          radius="md"
          variant="flat"
          label="Confirm password"
          labelPlacement="outside"
          value={confirm}
          onValueChange={onConfirm}
          autoComplete="new-password"
          isRequired
          isInvalid={passwordMismatch}
          errorMessage={
            passwordMismatch ? "Passwords don't match." : undefined
          }
          isDisabled={submitting}
        />

        {errorMessage && (
          <div
            role="alert"
            className="
              flex items-start gap-2
              rounded-lg
              bg-warning/10 ring-1 ring-inset ring-warning/30
              px-3 py-2
            "
          >
            <AlertTriangle
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning"
              strokeWidth={2.2}
              aria-hidden
            />
            <p className="text-[12.5px] leading-snug text-foreground">
              {errorMessage}
            </p>
          </div>
        )}

        <p className="mt-1 text-[12px] leading-snug text-foreground/55">
          You&apos;ll finish signup on your pod — your password lives
          there, not here.
        </p>

        <div className="mt-1 flex justify-end">
          <Button
            type="submit"
            color="primary"
            size="md"
            radius="md"
            isLoading={submitting}
            isDisabled={
              submitting ||
              password.length === 0 ||
              passwordTooShort ||
              passwordMismatch
            }
            startContent={
              submitting ? undefined : <KeyRound className="h-3.5 w-3.5" />
            }
            className="font-medium"
          >
            Create account
          </Button>
        </div>
      </form>
    </>
  );
}

function SuccessState({
  signupUrl,
  redirecting,
}: {
  signupUrl: string;
  redirecting: boolean;
}) {
  return (
    <>
      <header className="flex items-start gap-3">
        <span
          aria-hidden
          className="
            flex h-10 w-10 shrink-0 items-center justify-center
            rounded-lg
            bg-success/10
            ring-1 ring-inset ring-success/20
            text-success
          "
        >
          <Check className="h-5 w-5" strokeWidth={2.2} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-[20px] font-medium leading-tight tracking-tight text-foreground">
            Almost there
          </h2>
          <p className="mt-1 text-[13px] leading-snug text-foreground/65">
            {redirecting
              ? "Opening signup at your pod…"
              : "Account created. Redirecting to your pod…"}
          </p>
        </div>
        {redirecting && <Spinner size="sm" color="success" />}
      </header>
      <div className="flex justify-end">
        <Button
          as="a"
          href={signupUrl}
          color="primary"
          size="md"
          radius="md"
          endContent={<ExternalLink className="h-3.5 w-3.5" />}
          className="font-medium"
        >
          Continue to signup
        </Button>
      </div>
    </>
  );
}
