"use client";

/**
 * `BootstrapAdminCard` — first-admin claim card on the Eve home.
 *
 * Renders in place of the launcher when `useSetupStatus()` reports
 * `needsBootstrap`. Two modes for creating the admin:
 *
 *   1. Form (default): operator types email + name, we POST to
 *      `/api/pod/bootstrap-claim` (proxy → pod's
 *      `/api/admin/bootstrap/claim`). On success the pod has minted an
 *      invite tied to the email; we redirect the browser to the pod's
 *      registration URL so the user can complete Kratos signup.
 *
 *   2. CLI fallback (toggle): expand a copy-able command for operators
 *      who prefer the terminal — also shown automatically when the pod
 *      reports `no-bootstrap-token` (the dashboard can't speak the
 *      bootstrap protocol without env wiring).
 *
 * Visual rules:
 *   • Single centered Card, max-w 480px, vertically centered in body.
 *   • HeroUI primitives only (Card, Button, Input, Spinner). No raw
 *     `<div className="bg-…">` for theming surfaces.
 *   • visionOS material: `bg-foreground/[0.04] ring-1 ring-inset
 *     ring-foreground/10` — no drop shadows.
 *   • Concentric radii: pane 32 → body gutter 20 → card 12 (radius="md").
 *   • Foreground opacity tiers: 100 / 65 / 55 / 40.
 *
 * See: synap-team-docs/content/team/platform/eve-auth-architecture.mdx
 *      synap-team-docs/content/team/platform/eve-os-home-design.mdx
 */

import { useMemo, useState } from "react";
import {
  Button,
  Card,
  Input,
  Spinner,
  addToast,
} from "@heroui/react";
import {
  KeyRound,
  Terminal,
  Copy,
  Check,
  ExternalLink,
  AlertTriangle,
} from "lucide-react";

interface ClaimSuccess {
  ok: true;
  podUrl: string;
  signupUrl: string;
  email: string;
}

type BootstrapPhase =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; result: ClaimSuccess }
  | { kind: "redirecting"; result: ClaimSuccess }
  | { kind: "error"; message: string; missingToken?: boolean };

const CLI_COMMAND = "eve setup admin --magic-link";

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function localPart(email: string): string {
  const at = email.indexOf("@");
  return at > 0 ? email.slice(0, at) : "";
}

export function BootstrapAdminCard() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [showCli, setShowCli] = useState(false);
  const [phase, setPhase] = useState<BootstrapPhase>({ kind: "idle" });
  const [copied, setCopied] = useState(false);

  const emailLooksValid = useMemo(
    () => email.length === 0 || isValidEmail(email.trim()),
    [email],
  );

  const submitting = phase.kind === "submitting";
  const succeeded =
    phase.kind === "success" || phase.kind === "redirecting";

  const effectiveName = name.trim() || localPart(email.trim()) || undefined;

  async function handleClaim() {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !isValidEmail(cleanEmail)) {
      setPhase({
        kind: "error",
        message: "Enter a valid email address.",
      });
      return;
    }
    setPhase({ kind: "submitting" });
    try {
      const res = await fetch("/api/pod/bootstrap-claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: cleanEmail, name: effectiveName }),
      });
      const data = (await res.json().catch(() => null)) as
        | (Partial<ClaimSuccess> & { error?: string })
        | null;

      if (!res.ok) {
        const code =
          data && typeof data.error === "string" ? data.error : "";
        if (code === "no-bootstrap-token") {
          setShowCli(true);
          setPhase({
            kind: "error",
            message:
              "This Eve doesn't have an admin bootstrap token configured. Use the CLI command below from the host.",
            missingToken: true,
          });
          return;
        }
        if (code === "no-pod-url") {
          setPhase({
            kind: "error",
            message:
              "No pod URL configured yet. Open Settings to point this Eve at a pod first.",
          });
          return;
        }
        setPhase({
          kind: "error",
          message:
            (data && typeof data.error === "string" && data.error) ||
            "Couldn't create the admin invite. Try again.",
        });
        return;
      }

      // Success — pod has minted the invite. Show a brief "redirecting"
      // state so the operator knows the redirect is happening.
      const result: ClaimSuccess = {
        ok: true,
        podUrl: data?.podUrl ?? "",
        signupUrl: data?.signupUrl ?? "",
        email: data?.email ?? cleanEmail,
      };
      setPhase({ kind: "success", result });
      if (result.signupUrl) {
        setPhase({ kind: "redirecting", result });
        // Brief pause so the user sees the spinner — UX only.
        window.setTimeout(() => {
          window.location.assign(result.signupUrl);
        }, 600);
      }
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

  async function handleCopyCli() {
    try {
      await navigator.clipboard.writeText(CLI_COMMAND);
      setCopied(true);
      addToast({ title: "Command copied", color: "success" });
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      addToast({ title: "Couldn't copy", color: "danger" });
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-8">
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
        {/* Header — small glyph + title + subtitle */}
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
            <KeyRound className="h-5 w-5" strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-heading text-[20px] font-medium leading-tight tracking-tight text-foreground">
              Set up your first admin
            </h2>
            <p className="mt-1 text-[13px] leading-snug text-foreground/65">
              This Eve hasn&apos;t been claimed yet. The first user
              becomes the pod admin.
            </p>
          </div>
        </header>

        {/* Form */}
        {!succeeded && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!submitting) void handleClaim();
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
              placeholder="you@domain.com"
              value={email}
              onValueChange={setEmail}
              autoComplete="email"
              autoFocus
              isRequired
              isInvalid={!emailLooksValid && email.length > 0}
              errorMessage={
                !emailLooksValid && email.length > 0
                  ? "Enter a valid email address."
                  : undefined
              }
              spellCheck="false"
              isDisabled={submitting}
            />

            <Input
              size="md"
              radius="md"
              variant="flat"
              label="Name"
              labelPlacement="outside"
              placeholder={
                email && isValidEmail(email)
                  ? localPart(email)
                  : "Optional"
              }
              value={name}
              onValueChange={setName}
              autoComplete="name"
              spellCheck="false"
              isDisabled={submitting}
              description="Defaults to the local-part of your email."
            />

            {phase.kind === "error" && (
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
                  {phase.message}
                </p>
              </div>
            )}

            <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <Button
                type="button"
                variant="light"
                size="sm"
                radius="full"
                startContent={<Terminal className="h-3.5 w-3.5" />}
                onPress={() => setShowCli((v) => !v)}
                className="text-foreground/65 hover:text-foreground"
              >
                {showCli ? "Hide CLI command" : "Show me the CLI command"}
              </Button>
              <Button
                type="submit"
                color="primary"
                size="md"
                radius="md"
                isLoading={submitting}
                isDisabled={
                  submitting ||
                  email.trim().length === 0 ||
                  !isValidEmail(email.trim())
                }
                className="font-medium"
              >
                Create admin
              </Button>
            </div>
          </form>
        )}

        {/* Success / redirecting state */}
        {succeeded && (
          <div className="flex flex-col gap-3">
            <div
              className="
                flex items-start gap-3
                rounded-lg
                bg-success/10 ring-1 ring-inset ring-success/30
                px-3.5 py-3
              "
            >
              <Check
                className="mt-0.5 h-4 w-4 shrink-0 text-success"
                strokeWidth={2.2}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-foreground">
                  Invite minted for{" "}
                  <span className="text-foreground">
                    {phase.result.email}
                  </span>
                  .
                </p>
                <p className="mt-0.5 text-[12.5px] text-foreground/65">
                  {phase.kind === "redirecting"
                    ? "Opening signup at your pod…"
                    : "Open the signup page below to complete your account."}
                </p>
              </div>
              {phase.kind === "redirecting" && (
                <Spinner size="sm" color="success" />
              )}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
              {phase.result.signupUrl ? (
                <Button
                  as="a"
                  href={phase.result.signupUrl}
                  color="primary"
                  size="md"
                  radius="md"
                  endContent={<ExternalLink className="h-3.5 w-3.5" />}
                  className="font-medium"
                >
                  Complete signup
                </Button>
              ) : phase.result.podUrl ? (
                <Button
                  as="a"
                  href={phase.result.podUrl}
                  target="_blank"
                  rel="noreferrer"
                  color="primary"
                  size="md"
                  radius="md"
                  endContent={<ExternalLink className="h-3.5 w-3.5" />}
                  className="font-medium"
                >
                  Open {phase.result.podUrl}
                </Button>
              ) : null}
            </div>
          </div>
        )}

        {/* CLI fallback — collapsible */}
        {showCli && (
          <CliFallback copied={copied} onCopy={() => void handleCopyCli()} />
        )}
      </Card>
    </div>
  );
}

// ─── CLI fallback panel ──────────────────────────────────────────────────────

function CliFallback({
  copied,
  onCopy,
}: {
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div
      className="
        flex flex-col gap-2
        rounded-lg
        bg-foreground/[0.03] ring-1 ring-inset ring-foreground/10
        px-3.5 py-3
      "
    >
      <p className="text-[12px] font-medium uppercase tracking-[0.04em] text-foreground/55">
        From the host terminal
      </p>
      <div className="flex items-center gap-2">
        <pre
          className="
            min-w-0 flex-1 overflow-x-auto
            rounded-md
            bg-foreground/[0.04] ring-1 ring-inset ring-foreground/10
            px-3 py-2
            font-mono text-[12.5px] leading-snug text-foreground
          "
        >
          {CLI_COMMAND}
        </pre>
        <Button
          isIconOnly
          variant="flat"
          size="sm"
          radius="md"
          aria-label="Copy command"
          onPress={onCopy}
          className="shrink-0"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-success" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
      <p className="text-[12px] leading-snug text-foreground/55">
        The CLI generates a one-hour magic link and prints it locally,
        then waits while you complete signup in your browser.
      </p>
    </div>
  );
}

// ─── Sibling: unconfigured-pod card (no pod URL set yet) ─────────────────────

/**
 * Tiny variant rendered when `useSetupStatus()` is `unconfigured`. The
 * Home page imports this from the same module so the two states feel
 * like part of the same flow — same shell, different copy.
 */
export function ConfigurePodCard() {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-8">
      <Card
        isBlurred
        shadow="none"
        radius="md"
        className="
          flex w-full max-w-[480px] flex-col gap-4 p-6
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
              bg-warning/10
              ring-1 ring-inset ring-warning/20
              text-warning
            "
          >
            <AlertTriangle className="h-5 w-5" strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-heading text-[18px] font-medium leading-tight text-foreground">
              Configure your pod first
            </h2>
            <p className="mt-1 text-[13px] leading-snug text-foreground/65">
              Eve doesn&apos;t know which Synap pod to talk to yet.
              Point it at one to begin.
            </p>
          </div>
        </header>
        <div className="flex justify-end">
          <Button
            as="a"
            href="/settings"
            color="primary"
            size="md"
            radius="md"
            className="font-medium"
          >
            Open settings
          </Button>
        </div>
      </Card>
    </div>
  );
}
