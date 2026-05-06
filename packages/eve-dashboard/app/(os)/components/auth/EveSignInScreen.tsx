"use client";

/**
 * `EveSignInScreen` — full-page auth surface for Eve.
 *
 * Self-hosted only: connects to the operator's local pod.
 *
 * Two states:
 *
 *   1. **Inline Kratos form** — when the pod already has an admin,
 *      the user signs in (or registers) via the pod's Kratos flow.
 *
 *   2. **Bootstrap form** — when no admin exists yet, the operator
 *      sets up the first admin by submitting an email; the pod
 *      creates a user with an invite tied to the email, and we
 *      return a magic link URL the operator can copy and paste for
 *      the invitee to complete first-admin setup.
 *
 * Visual rules (Eve standard):
 *   • HeroUI primitives only — Card, Input, Button, Spinner.
 *   • visionOS material: `bg-foreground/[0.04] ring-1 ring-inset
 *     ring-foreground/10`. No drop shadows.
 *   • Concentric radii: pane 32 → outer 20 → card 12.
 *   • Foreground opacity tiers: 100 / 65 / 55 / 40.
 *
 * See:
 *   synap-team-docs/content/team/platform/eve-auth-architecture.mdx
 *   synap-team-docs/content/team/platform/eve-credentials.mdx
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Card,
  Input,
  Spinner,
} from "@heroui/react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  Mail,
  Server,
  Sparkles,
} from "lucide-react";
import { storePodSession } from "@/lib/synap-auth";

// ─── Types ──────────────────────────────────────────────────────────────────

export type EveSignInMode =
  | { kind: "self-hosted"; podUrl: string; email: string; signupUrl?: string };

export interface EveSignInScreenProps {
  onSuccess: (mode: EveSignInMode) => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function EveSignInScreen({ onSuccess }: EveSignInScreenProps) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-8 overflow-y-auto">
      <div className="w-full max-w-[28rem] flex flex-col items-center gap-6">
        {/* Brand */}
        <div className="flex flex-col items-center gap-2 text-center">
          <span
            aria-hidden
            className="
              flex h-12 w-12 items-center justify-center
              rounded-xl
              bg-primary/10 ring-1 ring-inset ring-primary/20
              text-primary
            "
          >
            <Sparkles className="h-6 w-6" strokeWidth={1.8} />
          </span>
          <h1 className="font-heading text-[24px] font-medium leading-tight tracking-tight text-foreground">
            Welcome to Eve
          </h1>
          <p className="text-[12.5px] text-foreground/55">
            Your sovereign stack for humans.
          </p>
        </div>

        <Card
          isBlurred
          shadow="none"
          radius="md"
          className="
            w-full p-5 sm:p-6
            bg-foreground/[0.04]
            ring-1 ring-inset ring-foreground/10
          "
        >
          <div className="flex flex-col gap-3 pt-1">
            <div className="flex items-center gap-2 text-center mx-auto">
              <Server className="h-3.5 w-3.5 text-foreground/40" strokeWidth={2} />
              <p className="text-[13px] font-medium text-foreground">
                Connect to your pod
              </p>
            </div>
            <p className="text-[12.5px] text-foreground/55 text-center">
              Self-hosted — your data stays on your machine.
            </p>
            <SelfHostedSignInForm
              onSuccess={(claim) =>
                onSuccess({
                  kind: "self-hosted",
                  podUrl: claim.podUrl,
                  email: claim.email,
                  signupUrl: claim.signupUrl,
                })
              }
            />
          </div>
        </Card>

        <p className="text-center text-[11.5px] text-foreground/40">
          Eve never sees your password — it goes straight to your pod.
        </p>
      </div>
    </div>
  );
}

// ─── Self-hosted form (extracted, reusable) ────────────────────────────────

interface SelfHostedClaimResult {
  podUrl: string;
  email: string;
  signupUrl?: string;
  magicLink?: string;
}

interface SelfHostedSignInFormProps {
  /**
   * If set, the form is rendered as the "Claim this pod" card from
   * `PodConnectGate`. The email field is pre-filled and locked to the
   * CP-signed-in user's email — they only confirm.
   */
  fixedEmail?: string;
  onSuccess: (result: SelfHostedClaimResult) => void;
}

interface BootstrapClaimResponse {
  ok?: boolean;
  podUrl?: string;
  signupUrl?: string;
  email?: string;
  error?: string;
}

interface MagicLinkResponse {
  ok?: boolean;
  url?: string;
  error?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SelfHostedSignInForm({
  fixedEmail,
  onSuccess,
}: SelfHostedSignInFormProps) {
  // Bootstrap form fields
  const [email, setEmail] = useState(fixedEmail ?? "");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missingToken, setMissingToken] = useState(false);

  // Post-claim state: show the magic link with copy button.
  const [claimedEmail, setClaimedEmail] = useState<string | null>(null);
  const [claimedPodUrl, setClaimedPodUrl] = useState<string | null>(null);
  const [magicLink, setMagicLink] = useState<string | null>(null);
  const [manglingLink, setMintingLink] = useState(false);
  const claimIdRef = useRef(0);

  // Probe whether the pod already has an admin. Three states:
  //   null  → still loading (show spinner)
  //   true  → admin exists → show inline Kratos login/registration form
  //   false → no admin yet → show bootstrap form
  const [podInitialized, setPodInitialized] = useState<boolean | null>(null);
  const [podUrl, setPodUrl] = useState<string | null>(null);

  // Kratos inline form state (used when podInitialized === true)
  const [kratosEmail, setKratosEmail] = useState(fixedEmail ?? "");
  const [kratosPassword, setKratosPassword] = useState("");
  const [kratosErrors, setKratosErrors] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/pod/setup-status", { cache: "no-store" });
        if (!res.ok) { if (!cancelled) setPodInitialized(false); return; }
        const data = (await res.json().catch(() => null)) as
          | { initialized?: boolean | null; reason?: string; podUrl?: string }
          | null;
        if (cancelled) return;
        setPodUrl(data?.podUrl ?? null);
        setPodInitialized(data?.initialized ?? false);
      } catch {
        if (!cancelled) setPodInitialized(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const emailLooksValid = useMemo(
    () => email.length === 0 || EMAIL_RE.test(email.trim()),
    [email],
  );

  const localPart = (s: string): string => {
    const at = s.indexOf("@");
    return at > 0 ? s.slice(0, at) : "";
  };

  async function handleKratosAuth(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const cleanEmail = kratosEmail.trim().toLowerCase();
    if (!cleanEmail || !EMAIL_RE.test(cleanEmail)) {
      setKratosErrors(["Enter a valid email address."]);
      return;
    }
    if (!kratosPassword) {
      setKratosErrors(["Password is required."]);
      return;
    }
    setKratosErrors([]);
    setSubmitting(true);
    try {
      const res = await fetch("/api/pod/kratos-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          mode: "login",
          email: cleanEmail,
          password: kratosPassword,
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | {
            ok?: boolean;
            sessionToken?: string;
            expiresAt?: string;
            user?: { id: string; email: string; name: string };
            error?: string;
            messages?: string[];
          }
        | null;

      if (!res.ok) {
        const msgs = data?.messages?.length
          ? data.messages
          : [data?.error ?? "Authentication failed. Check your credentials."];
        setKratosErrors(msgs);
        return;
      }

      if (data?.ok && data.sessionToken && podUrl) {
        storePodSession({
          podUrl,
          sessionToken: data.sessionToken,
          userEmail: data.user?.email ?? cleanEmail,
          userId: data.user?.id ?? "",
        });
        onSuccess({ podUrl, email: cleanEmail });
      }
    } catch (err) {
      setKratosErrors([
        err instanceof Error ? err.message : "Couldn't reach the dashboard API.",
      ]);
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePasswordReset() {
    if (!kratosEmail.trim()) {
      setKratosErrors(["Enter an email address first."]);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/pod/recovery-start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: kratosEmail.trim().toLowerCase(), mode: "password" }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; recoveryLink?: string; error?: string }
        | null;
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? "Couldn't start password reset.");
        return;
      }
      setClaimedEmail(kratosEmail.trim().toLowerCase());
      setMagicLink(data.recoveryLink ?? null);
      setClaimedPodUrl(podUrl ?? null);
    } catch {
      setError("Couldn't reach the dashboard API.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !EMAIL_RE.test(cleanEmail)) {
      setError("Enter a valid email address.");
      return;
    }
    setError(null);
    setMissingToken(false);
    setSubmitting(true);
    try {
      const res = await fetch("/api/pod/bootstrap-claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email: cleanEmail,
          name: name.trim() || undefined,
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | BootstrapClaimResponse
        | null;

      if (!res.ok) {
        const code = data?.error ?? "";
        if (code === "no-bootstrap-token") {
          setMissingToken(true);
          setError(
            "This Eve doesn't have an admin bootstrap token configured. Run `eve setup admin` from the host terminal.",
          );
          return;
        }
        if (code === "no-pod-url") {
          setError(
            "No pod URL configured yet. Open Settings to point Eve at a pod first.",
          );
          return;
        }
        setError(code || "Couldn't claim the pod. Try again.");
        return;
      }

      const claimedPodUrl = data?.podUrl ?? "";
      const claimedEmail = data?.email ?? cleanEmail;
      const claimId = ++claimIdRef.current;

      // Attempt to mint a Kratos session via the JWT-Bearer flow and
      // persist it into `synap:pods`. Succeeds for re-claims / existing
      // users; fails for first-time bootstrap (user doesn't exist on pod
      // yet). Non-fatal — fall through to redirect-based signup.
      try {
        const signinRes = await fetch("/api/auth/pod-signin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ email: claimedEmail }),
        });
        if (signinRes.ok) {
          const signin = (await signinRes.json().catch(() => null)) as
            | {
                ok?: boolean;
                token?: string;
                expiresAt?: string;
                user?: { id: string; email: string; name: string | null };
              }
            | null;
          if (signin?.ok && signin.token && claimedPodUrl) {
            storePodSession({
              podUrl: claimedPodUrl,
              sessionToken: signin.token,
              userEmail: signin.user?.email ?? claimedEmail,
              userId: signin.user?.id ?? "",
            });
          }
        }
      } catch {
        /* non-fatal */
      }

      // Mint a magic link the operator can copy-paste to the invitee.
      try {
        const magicRes = await fetch("/api/pod/magic-link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        const magicData = (await magicRes.json().catch(() => null)) as
          | MagicLinkResponse
          | null;
        if (magicRes.ok && magicData?.ok && magicData.url && claimId === claimIdRef.current) {
          setMagicLink(magicData.url);
          setClaimedEmail(claimedEmail);
          setClaimedPodUrl(claimedPodUrl);
        } else if (claimId === claimIdRef.current) {
          setClaimedEmail(claimedEmail);
          setClaimedPodUrl(claimedPodUrl);
        }
      } catch {
        /* non-fatal */
      }

      return;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't reach the dashboard API.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  // Still checking pod status
  if (podInitialized === null) {
    return (
      <div className="flex items-center justify-center py-6">
        <Spinner size="sm" />
      </div>
    );
  }

  // Admin already exists → inline Kratos login form.
  // Self-registration is not available from the UI — new users need an
  // invitation from the pod admin (see bootstrap claim flow).
  if (podInitialized === true) {
    return (
      <div className="flex flex-col gap-3">
        <form onSubmit={handleKratosAuth} className="flex flex-col gap-3" noValidate>
          <Input
            type="email"
            size="md"
            radius="md"
            variant="bordered"
            label="Email"
            labelPlacement="outside"
            placeholder="you@yourdomain.com"
            value={kratosEmail}
            onValueChange={setKratosEmail}
            autoComplete="email"
            autoFocus={!fixedEmail}
            isRequired
            isReadOnly={!!fixedEmail}
            spellCheck="false"
            isDisabled={submitting}
            startContent={
              <Mail className="h-3.5 w-3.5 text-foreground/55" strokeWidth={2} aria-hidden />
            }
          />
          <Input
            type="password"
            size="md"
            radius="md"
            variant="bordered"
            label="Password"
            labelPlacement="outside"
            placeholder="Your password"
            value={kratosPassword}
            onValueChange={setKratosPassword}
            autoComplete="current-password"
            isRequired
            isDisabled={submitting}
          />

          <button
            type="button"
            onClick={handlePasswordReset}
            className="self-end text-[12px] font-medium text-foreground/55 hover:text-primary transition-colors"
          >
            Forgot password?
          </button>

          {kratosErrors.length > 0 && (
            <div className="flex flex-col gap-1">
              {kratosErrors.map((msg, i) => (
                <ErrorRow key={i} message={msg} accent="danger" />
              ))}
            </div>
          )}

          <Button
            type="submit"
            color="primary"
            radius="md"
            size="md"
            isLoading={submitting}
            isDisabled={
              submitting ||
              !kratosEmail.trim() ||
              kratosPassword.length === 0
            }
            className="mt-1 font-medium"
            endContent={!submitting ? <ArrowRight className="h-3.5 w-3.5" /> : undefined}
          >
            Sign in
          </Button>
        </form>

        <p className="text-center text-[11.5px] text-foreground/40">
          New users: contact your admin for an invitation.
        </p>
      </div>
    );
  }

  // Post-claim: show magic link or signup URL with copy + continue.
  if (claimedEmail !== null) {
    return (
      <div className="flex flex-col gap-4">
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
              Invite ready for <span className="text-foreground">{claimedEmail}</span>.
            </p>
            <p className="mt-1 text-[12px] text-foreground/55">
              Share this link so the invitee can complete their signup:
            </p>

            {manglingLink && (
              <div className="mt-2 flex items-center gap-2 text-[12px] text-foreground/55">
                <Spinner size="sm" />
                <span>Minting link…</span>
              </div>
            )}

            {!manglingLink && magicLink && (
              <div className="mt-2 flex items-stretch gap-1.5">
                <code className="
                  flex-1
                  rounded-md
                  bg-foreground/5
                  px-2.5 py-2
                  text-[12px]
                  text-foreground/70
                  overflow-hidden
                  text-ellipsis
                  whitespace-nowrap
                ">
                  {magicLink}
                </code>
                <CopyLinkButton text={magicLink} />
              </div>
            )}

            {!manglingLink && !magicLink && claimedPodUrl && (
              <a
                href={`${claimedPodUrl}/auth/registration?invite=${encodeURIComponent(claimedEmail)}`}
                target="_blank"
                rel="noreferrer"
                className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline"
              >
                Complete signup at your pod
                <ExternalLink className="h-3 w-3" strokeWidth={2} />
              </a>
            )}
          </div>
        </div>

        <Button
          color="primary"
          radius="md"
          size="md"
          className="font-medium"
          onPress={() => {
            onSuccess({
              podUrl: claimedPodUrl ?? "",
              email: claimedEmail,
              signupUrl: claimedPodUrl
                ? `${claimedPodUrl}/auth/registration?invite=${encodeURIComponent(claimedEmail)}`
                : undefined,
            });
          }}
        >
          Continue to dashboard
        </Button>
      </div>
    );
  }

  // No admin yet → bootstrap form
  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
      <Input
        type="email"
        size="md"
        radius="md"
        variant="bordered"
        label="Email"
        labelPlacement="outside"
        placeholder="you@yourdomain.com"
        value={email}
        onValueChange={setEmail}
        autoComplete="email"
        autoFocus={!fixedEmail}
        isRequired
        isReadOnly={!!fixedEmail}
        isInvalid={!emailLooksValid && email.length > 0}
        errorMessage={
          !emailLooksValid && email.length > 0
            ? "Enter a valid email address."
            : undefined
        }
        spellCheck="false"
        isDisabled={submitting}
        startContent={
          <Mail className="h-3.5 w-3.5 text-foreground/55" strokeWidth={2} aria-hidden />
        }
      />
      {!fixedEmail && (
        <Input
          size="md"
          radius="md"
          variant="bordered"
          label="Name"
          labelPlacement="outside"
          placeholder={
            email && EMAIL_RE.test(email) ? localPart(email) : "Optional"
          }
          value={name}
          onValueChange={setName}
          autoComplete="name"
          spellCheck="false"
          isDisabled={submitting}
          description="Defaults to the local-part of your email."
        />
      )}

      {error && <ErrorRow message={error} accent={missingToken ? "warning" : "danger"} />}

      <Button
        type="submit"
        color="primary"
        radius="md"
        size="md"
        startContent={!submitting ? <KeyRound className="h-3.5 w-3.5" /> : undefined}
        isLoading={submitting}
        isDisabled={
          submitting ||
          email.trim().length === 0 ||
          !EMAIL_RE.test(email.trim())
        }
        className="font-medium"
      >
        {fixedEmail ? "Claim this pod" : "Set up admin"}
      </Button>
    </form>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function ErrorRow({
  message,
  accent = "warning",
}: {
  message: string;
  accent?: "warning" | "danger";
}) {
  const tone =
    accent === "danger"
      ? "bg-danger/10 ring-danger/30 text-danger"
      : "bg-warning/10 ring-warning/30 text-warning";
  return (
    <div
      role="alert"
      className={`flex items-start gap-2 rounded-lg ${tone} ring-1 ring-inset px-3 py-2`}
    >
      <AlertTriangle
        className="mt-0.5 h-3.5 w-3.5 shrink-0"
        strokeWidth={2.2}
        aria-hidden
      />
      <p className="text-[12.5px] leading-snug text-foreground">{message}</p>
    </div>
  );
}

function CopyLinkButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1800);
    });
  }, [text]);

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  return (
    <Button
      isIconOnly
      radius="md"
      size="sm"
      variant="flat"
      className={`!min-w-0 !w-7 !px-0 bg-foreground/5 text-foreground/55`}
      onPress={handleCopy}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-success" strokeWidth={2.2} />
      ) : (
        <Copy className="h-3.5 w-3.5" strokeWidth={2} />
      )}
    </Button>
  );
}

// Re-export so callers can compose a "Claim this pod" card without
// re-implementing the form.
export type { SelfHostedClaimResult };

// Tree-shake-friendly: tiny helpers re-exported for the dialog inside
// `PodConnectGate` (lets it show the success banner with a CTA after
// claim).
export function ClaimSuccessNotice({
  email,
  signupUrl,
}: {
  email: string;
  signupUrl?: string;
}) {
  return (
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
          Pod claimed — invite minted for{" "}
          <span className="text-foreground">{email}</span>.
        </p>
        {signupUrl && (
          <a
            href={signupUrl}
            className="mt-1 inline-flex items-center gap-1 text-[12.5px] font-medium text-primary hover:underline"
          >
            Complete signup at your pod
            <ExternalLink className="h-3 w-3" strokeWidth={2} />
          </a>
        )}
      </div>
      {!signupUrl && <Spinner size="sm" color="success" />}
    </div>
  );
}

export default EveSignInScreen;
