"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@heroui/react";
import { Eye, EyeOff } from "lucide-react";
import { storePodSession } from "@/lib/synap-auth";
import { Wordmark } from "../components/wordmark";
import { ThemeToggle } from "../components/theme-toggle";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setLoading(true);
    setErrors([]);

    try {
      const res = await fetch("/api/pod/kratos-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ mode: "login", email: email.trim(), password }),
      });

      const data = await res.json().catch(() => null) as {
        ok?: boolean;
        sessionToken?: string;
        podUrl?: string;
        user?: { id: string; email: string; name: string };
        error?: string;
        messages?: string[];
      } | null;

      if (res.ok) {
        // Populate localStorage so EveAccountGate can resolve the pod session.
        if (data?.sessionToken && data?.podUrl) {
          storePodSession({
            podUrl: data.podUrl,
            sessionToken: data.sessionToken,
            userEmail: data.user?.email ?? email.trim(),
            userId: data.user?.id ?? "",
          });
        }
        // First login: send to onboarding to propose the admin key setup.
        const onboardingDone = typeof window !== "undefined"
          && localStorage.getItem("eve:onboarding-done");
        router.push(onboardingDone ? "/" : "/onboarding");
        return;
      }
      if (data?.messages?.length) {
        setErrors(data.messages);
      } else {
        setErrors([data?.error ?? "Login failed. Check your credentials."]);
      }
    } catch {
      setErrors(["Could not reach the dashboard API."]);
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
          <div className="text-center mb-8">
            <h1 className="font-heading text-4xl font-medium tracking-tightest text-foreground">
              Welcome to your stack
            </h1>
            <p className="mt-3 text-default-500">
              Sign in with your Synap account.
            </p>
          </div>

          <form
            onSubmit={handleSubmit}
            className="rounded-2xl border border-divider bg-content1 p-6 sm:p-7 space-y-4"
          >
            <div className="space-y-1.5">
              <label htmlFor="email" className="block text-sm font-medium text-foreground">
                Email
              </label>
              <input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="email"
                autoFocus
                required
                className={
                  "w-full rounded-lg border bg-content2 px-3 py-3 text-sm text-foreground outline-none transition-colors placeholder:text-default-400 " +
                  (errors.length
                    ? "border-danger/60 focus:border-danger"
                    : "border-divider focus:border-primary/60")
                }
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="password" className="block text-sm font-medium text-foreground">
                Password
              </label>
              <div
                className={
                  "flex items-center gap-2 rounded-lg border bg-content2 px-3 transition-colors " +
                  (errors.length
                    ? "border-danger/60 focus-within:border-danger"
                    : "border-divider focus-within:border-primary/60")
                }
              >
                <input
                  id="password"
                  type={visible ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  className="flex-1 min-w-0 bg-transparent border-0 outline-none py-3 text-sm text-foreground placeholder:text-default-400"
                />
                <button
                  type="button"
                  onClick={() => setVisible(!visible)}
                  className="shrink-0 rounded p-1 text-default-400 hover:text-foreground transition-colors"
                  aria-label={visible ? "Hide password" : "Show password"}
                >
                  {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {errors.length > 0 && (
              <ul className="space-y-1" role="alert">
                {errors.map((msg, i) => (
                  <li key={i} className="text-xs text-danger">{msg}</li>
                ))}
              </ul>
            )}

            <Button
              type="submit"
              color="primary"
              size="lg"
              radius="md"
              className="w-full font-medium"
              isLoading={loading}
              isDisabled={!email.trim() || !password}
            >
              Sign in
            </Button>
          </form>

          <p className="mt-8 text-center text-xs text-default-400">
            Eve — sovereign stack for humans
          </p>
        </div>
      </main>
    </div>
  );
}
