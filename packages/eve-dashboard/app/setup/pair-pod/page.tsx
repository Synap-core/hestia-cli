"use client";

/**
 * `/setup/pair-pod` — first-launch sign-in shim.
 *
 * Cookie-only auth means there's no eve-side session to mint. We just
 * proxy a Kratos login/registration to the pod via
 * `POST /api/pod/kratos-auth`. The route sets the parent-domain
 * `ory_kratos_session` cookie on success, and the catch-all proxy
 * picks it up from there.
 *
 * If the operator already has a valid Kratos session (signed in via
 * pod-admin or any sibling Synap surface), `pairing-status` returns
 * `paired` and we skip the form entirely.
 */

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Spinner } from "@heroui/react";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Server,
} from "lucide-react";
import { Wordmark } from "../../components/wordmark";
import { storePodSession } from "@/lib/synap-auth";

interface KratosAuthResponse {
  ok?: boolean;
  sessionToken?: string;
  expiresAt?: string;
  podUrl?: string;
  user?: { id: string; email: string; name: string };
  error?: string;
  messages?: string[];
}

type Phase =
  | { kind: "loading" }
  | { kind: "form" }
  | { kind: "success"; podUrl: string }
  | { kind: "error"; message: string };

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
    try {
      const res = await fetch("/api/pod/pairing-status", {
        credentials: "include",
        cache: "no-store",
      });
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { state: string }
          | null;
        if (data?.state === "paired") {
          router.replace("/");
          return;
        }
      }
    } catch {
      // Can't check — proceed to form.
    }
    setPhase({ kind: "form" });
  }, [router]);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    void init();
  }, [init]);

  async function handleSubmit(
    email: string,
    password: string,
    mode: "login" | "registration",
    name?: string,
  ): Promise<string | null> {
    try {
      const res = await fetch("/api/pod/kratos-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ mode, email, password, name }),
      });
      const data = (await res.json().catch(() => null)) as KratosAuthResponse | null;

      if (!res.ok || !data?.ok) {
        if (data?.error === "pod-url-not-configured") {
          return "Pod URL is not configured. Run 'eve setup' on the host to point Eve at a pod first.";
        }
        return data?.messages?.join(" ") ?? "Authentication failed.";
      }

      if (data.podUrl && data.sessionToken) {
        storePodSession({
          podUrl: data.podUrl,
          sessionToken: data.sessionToken,
          userEmail: data.user?.email ?? email,
          userId: data.user?.id ?? "",
        });
      }

      setPhase({ kind: "success", podUrl: data.podUrl ?? "" });
      setTimeout(() => router.replace("/"), 900);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : "Couldn't reach the dashboard API.";
    }
  }

  if (phase.kind === "loading") {
    return (
      <PageShell>
        <LoadingCard />
      </PageShell>
    );
  }

  if (phase.kind === "form") {
    return (
      <PageShell>
        <KratosForm onSubmit={handleSubmit} />
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
          <Button color="primary" size="sm" radius="md" onPress={() => setPhase({ kind: "form" })}>
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

// ─── KratosForm ───────────────────────────────────────────────────────────────

function KratosForm({
  onSubmit,
}: {
  onSubmit: (
    email: string,
    password: string,
    mode: "login" | "registration",
    name?: string,
  ) => Promise<string | null>;
}) {
  const [mode, setMode] = useState<"login" | "registration">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const result = await onSubmit(email, password, mode, mode === "registration" ? name : undefined);
    if (result !== null) {
      setError(result);
    }
    setSubmitting(false);
  }

  return (
    <div className="w-full max-w-md rounded-2xl border border-divider bg-content1 p-8 space-y-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <span
          aria-hidden
          className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-inset ring-primary/20 text-primary"
        >
          <Server className="h-6 w-6" strokeWidth={1.8} />
        </span>
        <h1 className="font-heading text-[24px] font-medium leading-tight tracking-tight text-foreground">
          {mode === "login" ? "Sign in to your pod" : "Create a pod account"}
        </h1>
        <p className="text-[13px] text-foreground/55 max-w-[22rem]">
          {mode === "login"
            ? "Enter your credentials to connect Eve to your pod."
            : "Create an account on your pod."}
        </p>
      </div>

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
        {mode === "registration" && (
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-foreground/60">
              Name
            </label>
            <div className={`group flex items-center gap-2 rounded-lg border bg-content2 px-3 transition-colors ${error ? "border-danger/60" : "border-divider focus-within:border-primary/60"}`}>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                className="flex-1 min-w-0 bg-transparent border-0 outline-none py-3 text-sm text-foreground"
              />
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-foreground/60">
            Email
          </label>
          <div className={`group flex items-center gap-2 rounded-lg border bg-content2 px-3 transition-colors ${error ? "border-danger/60" : "border-divider focus-within:border-primary/60"}`}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              className="flex-1 min-w-0 bg-transparent border-0 outline-none py-3 text-sm text-foreground"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-foreground/60">
            Password
          </label>
          <div className={`group flex items-center gap-2 rounded-lg border bg-content2 px-3 transition-colors ${error ? "border-danger/60" : "border-divider focus-within:border-primary/60"}`}>
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
              className="flex-1 min-w-0 bg-transparent border-0 outline-none py-3 text-sm text-foreground"
            />
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
          </div>
        </div>

        {error && (
          <p className="text-xs text-danger" role="alert">
            {error}
          </p>
        )}

        <Button
          type="submit"
          color="primary"
          size="lg"
          radius="md"
          className="w-full"
          isLoading={submitting}
        >
          {mode === "login" ? "Sign in" : "Create account"}
        </Button>

        <div className="text-center text-sm text-default-500">
          {mode === "login" ? (
            <>
              Don&apos;t have an account?{" "}
              <Button
                variant="light"
                size="sm"
                onPress={() => { setMode("registration"); setError(null); }}
              >
                Register
              </Button>
            </>
          ) : (
            <>
              Already have one?{" "}
              <Button
                variant="light"
                size="sm"
                onPress={() => { setMode("login"); setError(null); }}
              >
                Sign in
              </Button>
            </>
          )}
        </div>
      </form>
    </div>
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

function stripProtocol(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}
