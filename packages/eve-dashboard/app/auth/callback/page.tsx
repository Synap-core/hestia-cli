"use client";

/**
 * OAuth callback page — the second half of the CP auth handshake.
 *
 * The CP redirects the operator's browser here with `?code=...&state=...`
 * after they consent. We:
 *
 *   1. Re-pop the saved `code_verifier` + `state` from sessionStorage
 *      (set by `initiateCpOAuth()` before the redirect).
 *   2. Verify `state` matches (CSRF protection — RFC 6749 §10.12).
 *   3. POST to `${CP_BASE_URL}/oauth/token` with
 *      grant_type=authorization_code + code + redirect_uri +
 *      client_id + code_verifier (PKCE — RFC 7636 §4.5).
 *   4. POST the access_token to `/api/secrets/cp-token` so the
 *      dashboard's server-side route handlers can attach it as a
 *      bearer to upstream calls without ever exposing it to other
 *      client-side code via localStorage / cookies.
 *   5. Redirect the user to `/` (the future OS Home — for now the
 *      stack-pulse dashboard at `/dashboard` since `/` itself is just
 *      a redirect stub).
 *
 * Failure modes are surfaced inline with a "try again" affordance —
 * we deliberately do NOT auto-retry, since a botched handshake is
 * usually a sign of stale state, not a transient blip.
 *
 * See: synap-team-docs/content/team/platform/eve-os-vision.mdx §6
 */

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Spinner } from "@heroui/react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import {
  CP_BASE_URL,
  CP_OAUTH_CLIENT_ID,
  consumeOAuthChallenge,
  initiateCpOAuth,
  persistCpUserToken,
} from "../../(home)/lib/cp-oauth";

type State =
  | { phase: "exchanging" }
  | { phase: "persisting" }
  | { phase: "done" }
  | { phase: "error"; message: string };

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  // OAuth error envelope — RFC 6749 §5.2
  error?: string;
  error_description?: string;
}

/**
 * Decode a JWT's payload to surface the `exp` claim. We do NOT validate
 * the signature — the CP minted the token, the marketplace endpoints
 * verify it on the server side. This is purely cosmetic so the secrets
 * file can carry an `expiresAt` hint for dashboards.
 */
function decodeJwtExp(jwt: string): string | undefined {
  try {
    const [, payload] = jwt.split(".");
    if (!payload) return undefined;
    const padded = payload.padEnd(
      payload.length + ((4 - (payload.length % 4)) % 4),
      "=",
    );
    const json = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
    const obj = JSON.parse(json) as { exp?: number };
    if (typeof obj.exp === "number" && obj.exp > 0) {
      return new Date(obj.exp * 1000).toISOString();
    }
  } catch {
    // best-effort
  }
  return undefined;
}

export default function CallbackPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [state, setState] = useState<State>({ phase: "exchanging" });

  // The OAuth handshake is single-shot. React StrictMode mounts effects
  // twice in dev, so we guard with a ref to avoid double-exchange (which
  // would burn the auth code on the second call).
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    void runHandshake();

    async function runHandshake() {
      // The CP can also redirect with an error envelope (e.g. user
      // denied consent). Surface that verbatim — they're rare but
      // legitimate end states.
      const err = params.get("error");
      if (err) {
        const desc = params.get("error_description");
        setState({
          phase: "error",
          message: `${err}${desc ? `: ${desc}` : ""}`,
        });
        return;
      }

      const code = params.get("code");
      const stateParam = params.get("state");
      if (!code || !stateParam) {
        setState({
          phase: "error",
          message: "Missing `code` or `state` in callback URL.",
        });
        return;
      }

      const { verifier, state: savedState } = consumeOAuthChallenge();
      if (!verifier || !savedState) {
        setState({
          phase: "error",
          message:
            "Lost track of the auth flow (sessionStorage was cleared). Please try signing in again.",
        });
        return;
      }
      if (savedState !== stateParam) {
        // Likely a CSRF probe or a stale tab — refuse and force a clean
        // restart.
        setState({
          phase: "error",
          message: "State mismatch — refusing to complete the handshake.",
        });
        return;
      }

      // Token exchange. Per RFC 6749 §4.1.3 + RFC 7636 §4.5 the body is
      // application/x-www-form-urlencoded.
      const redirectUri = `${window.location.origin}/auth/callback`;
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: CP_OAUTH_CLIENT_ID,
        code_verifier: verifier,
      });

      let tokenRes: Response;
      try {
        tokenRes = await fetch(`${CP_BASE_URL}/oauth/token`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body,
        });
      } catch (e) {
        setState({
          phase: "error",
          message: `Network error talking to CP: ${
            e instanceof Error ? e.message : "unknown"
          }`,
        });
        return;
      }

      if (!tokenRes.ok) {
        const text = await tokenRes.text().catch(() => "");
        setState({
          phase: "error",
          message: `CP token exchange failed (${tokenRes.status})${
            text ? `: ${text.slice(0, 240)}` : ""
          }`,
        });
        return;
      }

      const json = (await tokenRes
        .json()
        .catch(() => null)) as TokenResponse | null;
      if (!json || !json.access_token) {
        const errMsg = json?.error_description ?? json?.error ?? "no access_token in response";
        setState({ phase: "error", message: `CP returned: ${errMsg}` });
        return;
      }

      // Hand the JWT to the server-side route handler so it lands in
      // ~/.eve/secrets.json with mode 0600. The browser does NOT keep
      // a copy beyond this function.
      setState({ phase: "persisting" });
      const expiresAt =
        decodeJwtExp(json.access_token) ??
        (typeof json.expires_in === "number"
          ? new Date(Date.now() + json.expires_in * 1000).toISOString()
          : undefined);

      const ok = await persistCpUserToken({
        userToken: json.access_token,
        issuedAt: new Date().toISOString(),
        expiresAt,
      });
      if (!ok) {
        setState({
          phase: "error",
          message:
            "Couldn't persist token to ~/.eve/secrets.json. Check the dashboard logs.",
        });
        return;
      }

      setState({ phase: "done" });

      // Brief flash of the success state, then forward. `/` currently
      // redirects to `/dashboard` (the stack-pulse home); when the
      // OS Home ships in Phase 2, this no-op'd redirect will land on
      // it directly without changing this page.
      setTimeout(() => router.replace("/"), 600);
    }
  }, [params, router]);

  return (
    <main className="min-h-screen bg-background text-foreground flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-md rounded-2xl border border-divider bg-content1 p-8">
        {state.phase === "exchanging" && (
          <Status
            icon={<Spinner size="sm" color="primary" />}
            title="Finishing sign-in…"
            body="Exchanging your authorization code with Synap CP."
          />
        )}
        {state.phase === "persisting" && (
          <Status
            icon={<Spinner size="sm" color="primary" />}
            title="Saving credentials…"
            body="Writing the user token to ~/.eve/secrets.json."
          />
        )}
        {state.phase === "done" && (
          <Status
            icon={<CheckCircle2 className="h-5 w-5 text-success" />}
            title="Signed in to Synap CP"
            body="Redirecting you home…"
          />
        )}
        {state.phase === "error" && (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 text-danger">
                <AlertCircle className="h-5 w-5" />
              </span>
              <div className="flex-1 min-w-0">
                <h1 className="font-heading text-lg font-medium tracking-tightest text-foreground">
                  Sign-in failed
                </h1>
                <p className="mt-1 text-sm text-default-500 break-words">
                  {state.message}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                color="primary"
                size="sm"
                radius="md"
                onPress={() => void initiateCpOAuth()}
              >
                Try again
              </Button>
              <Button
                variant="bordered"
                size="sm"
                radius="md"
                onPress={() => router.replace("/")}
              >
                Back home
              </Button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function Status({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5">{icon}</span>
      <div className="flex-1 min-w-0">
        <h1 className="font-heading text-lg font-medium tracking-tightest text-foreground">
          {title}
        </h1>
        <p className="mt-1 text-sm text-default-500">{body}</p>
      </div>
    </div>
  );
}
