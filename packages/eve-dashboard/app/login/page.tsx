/**
 * Login page — supports two paths:
 *
 *   1. **Auto-SSO** (silent): If the browser already has a Kratos browser-flow
 *      cookie (`ory_kratos_session`), redirect through the callback to get an
 *      `eve-session` JWT without showing any UI.
 *
 *   2. **Manual sign-in** (fallback): If no Kratos cookie exists, show a
 *      "Sign in" button that starts the Kratos browser flow.
 */

"use client";

import { useEffect, useState } from "react";
import { Button } from "@heroui/react";
import { Wordmark } from "../components/wordmark";
import { ThemeToggle } from "../components/theme-toggle";

const ERROR_MESSAGES: Record<string, string> = {
  "no-pod": "Pod URL not configured. Run `eve init` to set up your pod.",
  "no-session": "Sign-in was cancelled or the session cookie was not received.",
  "invalid-session": "Session validation failed. Please try again.",
  "kratos-unavailable": "Could not reach the pod's auth service. Check that your pod is running.",
  "session-issue": "Failed to create dashboard session. Please try again.",
};

function hasKratosCookie(): boolean {
  if (typeof document === "undefined") return false;
  return /(?:^|;\s*)ory_kratos_session=/.test(document.cookie);
}

function LoginContent() {
  const [ssoRedirecting, setSsoRedirecting] = useState(true);
  const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const error = params.get("error");

  useEffect(() => {
    if (hasKratosCookie()) {
      // Kratos browser-flow cookie exists — redirect through callback
      // to get an eve-session JWT, then land back at the dashboard root.
      const callbackUrl = encodeURIComponent(
        `${window.location.origin}/api/pod/kratos-callback?next=/`,
      );
      window.location.href = `/api/pod/kratos-login?return_to=${callbackUrl}`;
    } else {
      setSsoRedirecting(false);
    }
  }, []);

  if (ssoRedirecting && hasKratosCookie()) {
    return null; // brief flash while redirecting
  }

  return (
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

        <div className="rounded-2xl border border-divider bg-content1 p-6 sm:p-7 space-y-4">
          {error && (
            <p className="text-xs text-danger text-center" role="alert">
              {ERROR_MESSAGES[error] ?? "An error occurred. Please try again."}
            </p>
          )}
          <Button
            as="a"
            href="/api/pod/kratos-login"
            color="primary"
            size="lg"
            radius="md"
            className="w-full font-medium"
          >
            Sign in
          </Button>
        </div>

        <p className="mt-8 text-center text-xs text-default-400">
          Eve — sovereign stack for humans
        </p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between px-6 py-5">
        <Wordmark size="md" />
        <ThemeToggle />
      </header>
      {/* No Suspense boundary here — login page should always render immediately */}
      <LoginContent />
    </div>
  );
}