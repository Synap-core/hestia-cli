"use client";

/**
 * `EveSignInScreen` — full-page auth surface for Eve.
 *
 * Two top-level tabs:
 *
 *   1. **Synap account** (default) — sign in / sign up to the Synap
 *      Control Plane (api.synap.live). Inner sub-tabs split between
 *      Sign in and Create account. The shared session that lands in
 *      `localStorage.synap:session` (and the cross-subdomain
 *      `synap-session` cookie) makes the user signed-in across every
 *      Synap surface (hub, studio, crm, marketplace, …).
 *
 *      If the user has 2FA enabled, `signInToCP` returns a
 *      `TwoFactorChallenge` marker — we swap to a 6-digit verifier
 *      step and call `verifyTotpLogin(code)`.
 *
 *   2. **Self-hosted** — bootstrap a local-only Eve. The flow is
 *      identical to the legacy `BootstrapAdminCard` (POST to
 *      `/api/pod/bootstrap-claim`), now wrapped in a shared
 *      `<SelfHostedSignInForm />` so the same component can be reused
 *      from the "Claim this pod" CTA inside `PodConnectGate`.
 *
 * Visual rules (Eve standard):
 *   • HeroUI primitives only — Card, Tabs, Input, Button, Spinner.
 *   • visionOS material: `bg-foreground/[0.04] ring-1 ring-inset
 *     ring-foreground/10`. No drop shadows.
 *   • Concentric radii: pane 32 → outer 20 → card 12.
 *   • Foreground opacity tiers: 100 / 65 / 55 / 40.
 *
 * See:
 *   synap-team-docs/content/team/platform/eve-auth-architecture.mdx
 *   synap-team-docs/content/team/platform/eve-credentials.mdx
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Input,
  Tabs,
  Tab,
  Spinner,
  addToast,
} from "@heroui/react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ExternalLink,
  KeyRound,
  Mail,
  Server,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  signInToControlPlane,
  signUpToControlPlane,
  storePodSession,
  verifyTotpLogin,
  type CPSession,
} from "@/lib/synap-auth";

// ─── Types ──────────────────────────────────────────────────────────────────

export type EveSignInMode =
  | { kind: "synap"; session: CPSession }
  | { kind: "self-hosted"; podUrl: string; email: string; signupUrl?: string };

export interface EveSignInScreenProps {
  onSuccess: (mode: EveSignInMode) => void;
}

type TopTab = "synap" | "self-hosted";

// ─── Component ──────────────────────────────────────────────────────────────

export function EveSignInScreen({ onSuccess }: EveSignInScreenProps) {
  const [tab, setTab] = useState<TopTab>("synap");

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
          <Tabs
            selectedKey={tab}
            onSelectionChange={(k) => setTab(k as TopTab)}
            fullWidth
            size="sm"
            color="primary"
            radius="md"
            aria-label="Sign-in mode"
          >
            <Tab
              key="synap"
              title={
                <span className="flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
                  Synap account
                </span>
              }
            >
              <div className="flex flex-col gap-3 pt-3">
                <p className="text-[12.5px] text-foreground/55">
                  Sign in once, access every Synap app.
                </p>
                <SynapAccountPanel onSuccess={onSuccess} />
              </div>
            </Tab>
            <Tab
              key="self-hosted"
              title={
                <span className="flex items-center gap-1.5">
                  <Server className="h-3.5 w-3.5" strokeWidth={2} />
                  Self-hosted
                </span>
              }
            >
              <div className="flex flex-col gap-3 pt-3">
                <p className="text-[12.5px] text-foreground/55">
                  Use this Eve without a Synap account.
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
            </Tab>
          </Tabs>
        </Card>

        <p className="text-center text-[11.5px] text-foreground/40">
          Eve never sees your password — it goes straight to the CP or your pod.
        </p>
      </div>
    </div>
  );
}

// ─── Synap account panel (sub-tabs + 2FA) ───────────────────────────────────

type SynapSubTab = "sign-in" | "sign-up";
type SynapPhase =
  | { kind: "form" }
  | { kind: "submitting" }
  | { kind: "two-factor"; email: string }
  | { kind: "verifying" };

function SynapAccountPanel({
  onSuccess,
}: {
  onSuccess: (mode: EveSignInMode) => void;
}) {
  const [sub, setSub] = useState<SynapSubTab>("sign-in");
  const [phase, setPhase] = useState<SynapPhase>({ kind: "form" });
  const [error, setError] = useState<string | null>(null);

  // Sign-in fields
  const [signInEmail, setSignInEmail] = useState("");
  const [signInPassword, setSignInPassword] = useState("");

  // Sign-up fields
  const [signUpName, setSignUpName] = useState("");
  const [signUpEmail, setSignUpEmail] = useState("");
  const [signUpPassword, setSignUpPassword] = useState("");

  // 2FA field
  const [code, setCode] = useState("");

  const submitting =
    phase.kind === "submitting" || phase.kind === "verifying";

  function mapAuthError(err: unknown, mode: SynapSubTab): string {
    const raw = err instanceof Error ? err.message : String(err);
    const lower = raw.toLowerCase();
    if (
      lower.includes("invalid") &&
      (lower.includes("credentials") || lower.includes("password"))
    ) {
      return "Wrong email or password.";
    }
    if (lower.includes("user_already_exists") || lower.includes("already exists")) {
      return "An account with that email already exists. Try signing in.";
    }
    if (lower.includes("network") || lower.includes("failed to fetch")) {
      return "Couldn't reach Synap. Check your network.";
    }
    if (lower.includes("rate") || lower.includes("too many")) {
      return "Too many attempts — wait a moment, then try again.";
    }
    return mode === "sign-in"
      ? "Sign-in failed. Double-check your credentials."
      : "Couldn't create your account.";
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setPhase({ kind: "submitting" });
    try {
      const result = await signInToControlPlane(
        signInEmail.trim(),
        signInPassword,
      );
      if (result.kind === "two-factor-required") {
        setPhase({ kind: "two-factor", email: result.email });
        return;
      }
      addToast({ title: "Signed in", color: "success" });
      onSuccess({ kind: "synap", session: result.session });
    } catch (err) {
      setError(mapAuthError(err, "sign-in"));
      setPhase({ kind: "form" });
    }
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setPhase({ kind: "submitting" });
    try {
      const session = await signUpToControlPlane(
        signUpEmail.trim(),
        signUpPassword,
        signUpName.trim() || signUpEmail.trim(),
      );
      addToast({ title: "Account created", color: "success" });
      onSuccess({ kind: "synap", session });
    } catch (err) {
      setError(mapAuthError(err, "sign-up"));
      setPhase({ kind: "form" });
    }
  }

  async function handleVerifyTotp(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim();
    if (!/^\d{6,8}$/.test(trimmed)) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setError(null);
    setPhase({ kind: "verifying" });
    try {
      const result = await verifyTotpLogin(trimmed);
      if (!result.ok) {
        setError(result.error);
        setPhase({
          kind: "two-factor",
          email: phase.kind === "two-factor" ? phase.email : "",
        });
        return;
      }
      addToast({ title: "Signed in", color: "success" });
      onSuccess({ kind: "synap", session: result.session });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed.");
      setPhase({
        kind: "two-factor",
        email: phase.kind === "two-factor" ? phase.email : "",
      });
    }
  }

  // ── 2FA step ──────────────────────────────────────────────────────────────

  if (phase.kind === "two-factor" || phase.kind === "verifying") {
    return (
      <form
        onSubmit={handleVerifyTotp}
        className="flex flex-col gap-3"
        noValidate
      >
        <div
          className="
            flex items-start gap-3
            rounded-lg
            bg-foreground/[0.04] ring-1 ring-inset ring-foreground/10
            px-3.5 py-3
          "
        >
          <ShieldCheck
            className="mt-0.5 h-4 w-4 shrink-0 text-primary"
            strokeWidth={2}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-foreground">
              Two-factor authentication
            </p>
            <p className="mt-0.5 text-[12px] text-foreground/55">
              Enter the 6-digit code from your authenticator app for{" "}
              <span className="text-foreground/85">
                {phase.kind === "two-factor"
                  ? phase.email
                  : "your account"}
              </span>
              .
            </p>
          </div>
        </div>

        <Input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="one-time-code"
          size="md"
          radius="md"
          variant="bordered"
          label="Authentication code"
          labelPlacement="outside"
          placeholder="123456"
          value={code}
          onValueChange={setCode}
          maxLength={8}
          autoFocus
          isDisabled={submitting}
          isInvalid={!!error}
          spellCheck="false"
        />

        {error && <ErrorRow message={error} />}

        <Button
          type="submit"
          color="primary"
          radius="md"
          size="md"
          isLoading={submitting}
          isDisabled={submitting || code.trim().length < 6}
          className="font-medium"
        >
          Verify
        </Button>

        <button
          type="button"
          onClick={() => {
            setError(null);
            setCode("");
            setPhase({ kind: "form" });
          }}
          className="text-[12px] text-foreground/55 hover:text-foreground self-center"
        >
          Use a different account
        </button>
      </form>
    );
  }

  // ── Sign-in / sign-up sub-tabs ────────────────────────────────────────────

  return (
    <Tabs
      selectedKey={sub}
      onSelectionChange={(k) => {
        setSub(k as SynapSubTab);
        setError(null);
      }}
      fullWidth
      size="sm"
      variant="underlined"
      color="primary"
      aria-label="Synap account mode"
    >
      <Tab key="sign-in" title="Sign in">
        <form onSubmit={handleSignIn} className="flex flex-col gap-3 pt-2" noValidate>
          <Input
            type="email"
            size="md"
            radius="md"
            variant="bordered"
            label="Email"
            labelPlacement="outside"
            placeholder="you@example.com"
            value={signInEmail}
            onValueChange={setSignInEmail}
            autoComplete="email"
            autoFocus
            isRequired
            isDisabled={submitting}
            spellCheck="false"
          />
          <Input
            type="password"
            size="md"
            radius="md"
            variant="bordered"
            label="Password"
            labelPlacement="outside"
            placeholder="Your password"
            value={signInPassword}
            onValueChange={setSignInPassword}
            autoComplete="current-password"
            isRequired
            isDisabled={submitting}
          />
          {error && <ErrorRow message={error} />}
          <Button
            type="submit"
            color="primary"
            radius="md"
            size="md"
            isLoading={submitting}
            isDisabled={
              submitting ||
              !signInEmail.trim() ||
              signInPassword.length === 0
            }
            className="mt-1 font-medium"
            endContent={!submitting ? <ArrowRight className="h-3.5 w-3.5" /> : undefined}
          >
            Continue
          </Button>
        </form>
      </Tab>
      <Tab key="sign-up" title="Create account">
        <form onSubmit={handleSignUp} className="flex flex-col gap-3 pt-2" noValidate>
          <Input
            type="text"
            size="md"
            radius="md"
            variant="bordered"
            label="Name"
            labelPlacement="outside"
            placeholder="Your name"
            value={signUpName}
            onValueChange={setSignUpName}
            autoComplete="name"
            autoFocus
            isRequired
            isDisabled={submitting}
            spellCheck="false"
          />
          <Input
            type="email"
            size="md"
            radius="md"
            variant="bordered"
            label="Email"
            labelPlacement="outside"
            placeholder="you@example.com"
            value={signUpEmail}
            onValueChange={setSignUpEmail}
            autoComplete="email"
            isRequired
            isDisabled={submitting}
            spellCheck="false"
          />
          <Input
            type="password"
            size="md"
            radius="md"
            variant="bordered"
            label="Password"
            labelPlacement="outside"
            placeholder="At least 8 characters"
            value={signUpPassword}
            onValueChange={setSignUpPassword}
            autoComplete="new-password"
            isRequired
            isDisabled={submitting}
          />
          {error && <ErrorRow message={error} />}
          <Button
            type="submit"
            color="primary"
            radius="md"
            size="md"
            isLoading={submitting}
            isDisabled={
              submitting ||
              !signUpEmail.trim() ||
              signUpPassword.length < 8 ||
              !signUpName.trim()
            }
            className="mt-1 font-medium"
          >
            Create account
          </Button>
        </form>
      </Tab>
    </Tabs>
  );
}

// ─── Self-hosted form (extracted, reusable) ────────────────────────────────

interface SelfHostedClaimResult {
  podUrl: string;
  email: string;
  signupUrl?: string;
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SelfHostedSignInForm({
  fixedEmail,
  onSuccess,
}: SelfHostedSignInFormProps) {
  const [email, setEmail] = useState(fixedEmail ?? "");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missingToken, setMissingToken] = useState(false);

  // Probe whether the pod already has an admin. Three states:
  //   null  → still loading (show spinner)
  //   true  → admin exists → show sign-in + connect flow
  //   false → no admin yet → show bootstrap form
  const [podInitialized, setPodInitialized] = useState<boolean | null>(null);
  const [podUrl, setPodUrl] = useState<string | null>(null);

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

  // When pod already has an admin: attempt JWT-Bearer sign-in on window focus
  // so the operator doesn't have to manually click Connect after returning from
  // the pod's login page. Defined unconditionally (hooks rules).
  const tryConnect = useCallback(async () => {
    if (podInitialized !== true) return;
    if (submitting) return;
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !EMAIL_RE.test(cleanEmail)) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/pod-signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: cleanEmail }),
      });
      if (!res.ok) {
        // Not signed in yet — silently ignore on auto-focus attempts.
        return;
      }
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; token?: string; expiresAt?: string; user?: { id: string; email: string; name: string | null } }
        | null;
      if (data?.ok && data.token && podUrl) {
        storePodSession({
          podUrl,
          sessionToken: data.token,
          userEmail: data.user?.email ?? cleanEmail,
          userId: data.user?.id ?? "",
        });
        onSuccess({ podUrl, email: cleanEmail });
      }
    } catch {
      /* silent — will retry on next focus */
    } finally {
      setSubmitting(false);
    }
  }, [podInitialized, submitting, email, podUrl, onSuccess]);

  // Auto-attempt on window focus when pod already has an admin.
  useEffect(() => {
    if (podInitialized !== true) return;
    const onFocus = () => void tryConnect();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [podInitialized, tryConnect]);

  const emailLooksValid = useMemo(
    () => email.length === 0 || EMAIL_RE.test(email.trim()),
    [email],
  );

  const localPart = (s: string): string => {
    const at = s.indexOf("@");
    return at > 0 ? s.slice(0, at) : "";
  };

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

      // Attempt to mint a Kratos session via the JWT-Bearer flow and
      // persist it into `synap:pods`. Succeeds for re-claims / existing
      // users; fails for first-time bootstrap (user doesn't exist on pod
      // yet). Non-fatal — fall through to the Kratos signup redirect.
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
        /* non-fatal — fall through to redirect-based signup */
      }

      onSuccess({
        podUrl: claimedPodUrl,
        email: claimedEmail,
        signupUrl: data?.signupUrl,
      });
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

  // Admin already exists → show "sign in at pod + connect" flow.
  // tryConnect + focus listener are wired above (unconditionally).
  if (podInitialized === true) {
    const loginUrl = podUrl ? `${podUrl.replace(/\/+$/, "")}/auth/login` : null;
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-3 rounded-lg bg-success/10 ring-1 ring-inset ring-success/30 px-3.5 py-3">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" strokeWidth={2.2} aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-foreground">
              Admin account already set up
            </p>
            <p className="mt-0.5 text-[12px] text-foreground/55">
              Sign in at your pod, then return here and click Connect.
            </p>
          </div>
        </div>

        <Input
          type="email"
          size="md"
          radius="md"
          variant="bordered"
          label="Your email"
          labelPlacement="outside"
          placeholder="you@yourdomain.com"
          value={email}
          onValueChange={setEmail}
          autoComplete="email"
          isDisabled={submitting}
          spellCheck="false"
          startContent={
            <Mail className="h-3.5 w-3.5 text-foreground/55" strokeWidth={2} aria-hidden />
          }
        />

        <div className="flex gap-2">
          {loginUrl && (
            <Button
              as="a"
              href={loginUrl}
              target="_blank"
              rel="noopener noreferrer"
              variant="bordered"
              radius="md"
              size="md"
              className="flex-1 font-medium"
              endContent={<ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />}
            >
              Sign in at pod
            </Button>
          )}
          <Button
            color="primary"
            radius="md"
            size="md"
            className="flex-1 font-medium"
            isLoading={submitting}
            isDisabled={submitting || !email.trim() || !EMAIL_RE.test(email.trim())}
            onPress={() => void tryConnect()}
          >
            Connect
          </Button>
        </div>

        <p className="text-center text-[11.5px] text-foreground/40">
          After signing in at your pod, click Connect — or just switch back to this tab.
        </p>
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
