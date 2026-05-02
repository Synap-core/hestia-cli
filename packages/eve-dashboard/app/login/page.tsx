"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input, Button, addToast } from "@heroui/react";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { Wordmark } from "../components/wordmark";
import { ThemeToggle } from "../components/theme-toggle";

export default function LoginPage() {
  const router = useRouter();
  const [secret, setSecret] = useState("");
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!secret.trim()) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ secret: secret.trim() }),
      });

      if (res.ok) {
        addToast({ title: "Welcome back", color: "success" });
        router.push("/dashboard");
      } else {
        const data = await res.json() as { error?: string };
        setError(data.error ?? "Invalid key");
      }
    } catch {
      setError("Could not reach the dashboard API");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top bar — wordmark on the left, theme toggle on the right. */}
      <header className="flex items-center justify-between px-6 py-5">
        <Wordmark size="md" />
        <ThemeToggle />
      </header>

      {/* Content — centered card on a calm background. */}
      <main className="flex-1 flex items-center justify-center px-4 pb-20">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <h1 className="font-heading text-4xl font-medium tracking-tightest text-foreground">
              Welcome to your stack
            </h1>
            <p className="mt-3 text-default-500">
              Unlock the dashboard with your local key.
            </p>
          </div>

          <form
            onSubmit={handleSubmit}
            className="rounded-2xl border border-divider bg-content1 p-6 sm:p-7 space-y-5"
          >
            <Input
              type={visible ? "text" : "password"}
              label="Dashboard key"
              labelPlacement="outside"
              placeholder="Paste your key"
              value={secret}
              onValueChange={setSecret}
              autoComplete="off"
              autoFocus
              startContent={
                <KeyRound className="h-4 w-4 shrink-0 text-default-400" />
              }
              endContent={
                <button
                  type="button"
                  onClick={() => setVisible(!visible)}
                  className="text-default-400 hover:text-foreground transition-colors"
                  aria-label={visible ? "Hide key" : "Show key"}
                >
                  {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              }
              isInvalid={!!error}
              errorMessage={error ?? undefined}
              variant="bordered"
              size="lg"
              classNames={{
                // Mono ONLY on the typed value, not the label/placeholder.
                input: "font-mono text-sm tracking-tight",
                inputWrapper: "h-12",
                label: "font-sans",
              }}
            />
            <Button
              type="submit"
              color="primary"
              size="lg"
              radius="md"
              className="w-full font-medium"
              isLoading={loading}
              isDisabled={!secret.trim()}
            >
              Unlock
            </Button>

            <p className="text-center text-xs text-default-400">
              Don&apos;t have a key? Run{" "}
              <code className="rounded bg-content2 px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                eve ui
              </code>{" "}
              on the host.
            </p>
          </form>

          <p className="mt-8 text-center text-xs text-default-400">
            Eve — sovereign stack for humans
          </p>
        </div>
      </main>
    </div>
  );
}
