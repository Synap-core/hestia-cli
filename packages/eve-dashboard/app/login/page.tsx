"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader, Input, Button, addToast } from "@heroui/react";
import { Eye, EyeOff, KeyRound } from "lucide-react";

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
        addToast({ title: "Authenticated", color: "success" });
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
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="text-5xl mb-4">🌿</div>
          <h1 className="text-2xl font-bold text-foreground">Eve Dashboard</h1>
          <p className="text-default-500 text-sm">Sovereign stack control panel</p>
        </div>

        <Card className="bg-content1 border border-divider">
          <CardHeader className="pb-0">
            <div className="flex flex-col gap-1">
              <h2 className="text-base font-semibold text-foreground">Enter your dashboard key</h2>
              <p className="text-xs text-default-400">
                Run <code className="bg-content2 px-1 py-0.5 rounded text-primary font-mono">eve ui</code> in your terminal to see your key.
              </p>
            </div>
          </CardHeader>
          <CardBody>
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                type={visible ? "text" : "password"}
                label="Dashboard key"
                placeholder="Paste your key here"
                value={secret}
                onValueChange={setSecret}
                startContent={<KeyRound className="text-default-400 w-4 h-4 shrink-0" />}
                endContent={
                  <button
                    type="button"
                    onClick={() => setVisible(!visible)}
                    className="text-default-400 hover:text-default-600 transition-colors"
                    aria-label={visible ? "Hide key" : "Show key"}
                  >
                    {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                }
                isInvalid={!!error}
                errorMessage={error ?? undefined}
                variant="bordered"
                classNames={{ inputWrapper: "font-mono" }}
              />
              <Button
                type="submit"
                color="primary"
                className="w-full"
                isLoading={loading}
                isDisabled={!secret.trim()}
              >
                Unlock
              </Button>
            </form>
          </CardBody>
        </Card>

        <p className="text-center text-xs text-default-300">
          Eve — sovereign stack for humans
        </p>
      </div>
    </div>
  );
}
