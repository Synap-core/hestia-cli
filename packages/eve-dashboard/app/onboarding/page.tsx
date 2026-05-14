"use client";

/**
 * /onboarding — post-login admin key setup.
 *
 * Shown once after first Kratos login (tracked via localStorage
 * `eve:onboarding-done`). Lets the pod owner enter their admin key
 * (from `eve auth token`) to unlock admin features. Fully skippable —
 * non-admin users can use the dashboard without it.
 *
 * The admin key re-issues the eve-session JWT with admin:true so
 * admin-gated features remain unlocked across the session.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@heroui/react";
import { ArrowRight, KeyRound, ShieldCheck, SkipForward, Terminal } from "lucide-react";
import { Wordmark } from "../components/wordmark";
import { ThemeToggle } from "../components/theme-toggle";

const ONBOARDING_DONE_KEY = "eve:onboarding-done";

export default function OnboardingPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function finish() {
    if (typeof window !== "undefined") {
      localStorage.setItem(ONBOARDING_DONE_KEY, "1");
    }
    router.push("/");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token.trim() || loading) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/admin-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token: token.trim() }),
      });

      if (res.ok) {
        setDone(true);
        setTimeout(finish, 900);
        return;
      }

      const data = await res.json().catch(() => null) as { error?: string } | null;
      if (data?.error === "invalid-token") {
        setError('Invalid key. Use the "Your dashboard key" value printed by `eve ui`.');
      } else if (data?.error === "not-configured") {
        setError("Dashboard not configured yet. Run `eve ui` on your server first.");
      } else {
        setError("Could not verify the key. Try again.");
      }
    } catch {
      setError("Could not reach the dashboard API.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between px-6 py-5">
        <Wordmark size="md" />
        <ThemeToggle />
      </header>

      <main className="flex-1 flex items-center justify-center px-4 pb-20">
        <div className="w-full max-w-md">

          {/* Icon + headline */}
          <div className="text-center mb-8">
            <span
              aria-hidden
              className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-inset ring-primary/20 text-primary mb-4"
            >
              <ShieldCheck className="h-7 w-7" strokeWidth={1.8} />
            </span>
            <h1 className="font-heading text-3xl font-medium tracking-tight text-foreground">
              Unlock admin access
            </h1>
            <p className="mt-2 text-sm text-default-500">
              Enter your admin key to enable system settings and component management.
              You can skip this and do it later in Settings.
            </p>
          </div>

          {/* Card */}
          <form
            onSubmit={handleSubmit}
            className="rounded-2xl border border-divider bg-content1 p-6 sm:p-7 space-y-5"
          >
            <Input
              type="password"
              size="lg"
              radius="md"
              variant="bordered"
              label="Admin key"
              labelPlacement="outside"
              placeholder="Paste your key here"
              value={token}
              onValueChange={setToken}
              autoFocus
              isDisabled={loading || done}
              startContent={
                <KeyRound className="h-4 w-4 text-default-400" strokeWidth={2} aria-hidden />
              }
            />

            {/* Hint */}
            <div className="flex items-start gap-2.5 rounded-lg bg-default-50 border border-divider px-3.5 py-3">
              <Terminal className="h-3.5 w-3.5 shrink-0 mt-0.5 text-default-400" strokeWidth={2} />
              <p className="text-xs text-default-500 leading-relaxed">
                The key is printed when you run{" "}
                <code className="rounded bg-default-100 px-1 py-0.5 text-default-700 font-mono text-[11px]">
                  eve ui
                </code>{" "}
                on your server (labelled "Your dashboard key").
              </p>
            </div>

            {error && (
              <p role="alert" className="text-xs text-danger">
                {error}
              </p>
            )}

            <Button
              type="submit"
              color="primary"
              size="lg"
              radius="md"
              className="w-full font-medium"
              isLoading={loading}
              isDisabled={!token.trim() || loading || done}
              endContent={
                done
                  ? <ShieldCheck className="h-4 w-4" />
                  : !loading
                    ? <ArrowRight className="h-4 w-4" />
                    : undefined
              }
            >
              {done ? "Admin access granted" : "Verify key"}
            </Button>
          </form>

          {/* Skip */}
          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={finish}
              disabled={loading || done}
              className="inline-flex items-center gap-1.5 text-sm text-default-400 hover:text-default-600 transition-colors disabled:opacity-40"
            >
              <SkipForward className="h-3.5 w-3.5" strokeWidth={2} />
              Skip for now
            </button>
            <p className="mt-1.5 text-xs text-default-300">
              You can enter the key later in Settings → Admin.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
