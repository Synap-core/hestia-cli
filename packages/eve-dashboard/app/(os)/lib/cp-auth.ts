/**
 * Eve ↔ Synap CP sign-in resolver.
 *
 * Picks the right auth flow based on where Eve is running:
 *
 *   • **Loopback** (127.0.0.1, ::1, localhost) — full-page redirect
 *     PKCE OAuth (the existing `cp-oauth.ts` machinery). Fastest UX,
 *     CP allows arbitrary loopback ports per RFC 8252 §7.3.
 *
 *   • **Anywhere else** (custom domain, behind a reverse proxy,
 *     headless server, NAT) — RFC 8628 device flow. The dashboard
 *     shows a short user_code; the operator visits `synap.live/device`
 *     on any signed-in browser to approve. No redirect URI needed,
 *     so no per-tenant CP allow-listing.
 *
 * Both flows store the resulting JWT server-side in
 * `~/.eve/secrets.json` — the browser never holds the token. All
 * marketplace calls go through the same-origin `/api/marketplace/*`
 * proxies, so no CORS regardless of which flow signed the user in.
 *
 * See: synap-team-docs/content/team/platform/eve-os-vision.mdx §6
 */

import { initiateCpOAuth } from "./cp-oauth";

// ─── Hostname classification ─────────────────────────────────────────────────

/**
 * RFC 6761 §6.3 — `localhost` is reserved as loopback. Browsers + the
 * OS resolver always map it to 127.0.0.1 / [::1], so we treat it as
 * such. The CP's redirect-URI validator accepts the same set.
 */
const LOOPBACK_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
  "::1",
  "0.0.0.0",
]);

export function isLoopbackHost(hostname: string): boolean {
  if (LOOPBACK_HOSTNAMES.has(hostname)) return true;
  // Cover `127.x.x.x` — the entire 127/8 block is loopback per RFC 5735.
  if (/^127\.\d+\.\d+\.\d+$/.test(hostname)) return true;
  return false;
}

// ─── Resolver ────────────────────────────────────────────────────────────────

export type AuthMethod = "pkce-redirect" | "device-flow";

export function resolveAuthMethod(): AuthMethod {
  if (typeof window === "undefined") {
    // Defensive — this should never run on the server. Default to
    // device flow since it's the safer answer when in doubt (works
    // everywhere; PKCE only works for loopback).
    return "device-flow";
  }
  return isLoopbackHost(window.location.hostname)
    ? "pkce-redirect"
    : "device-flow";
}

// ─── Public entry point ──────────────────────────────────────────────────────

export type DeviceFlowState =
  | { kind: "starting" }
  | {
      kind: "awaiting-user";
      userCode: string;
      verificationUri: string;
      verificationUriComplete: string;
      expiresIn: number;
    }
  | { kind: "approved" }
  | { kind: "denied"; message?: string }
  | { kind: "expired"; message?: string }
  | { kind: "error"; message: string };

/**
 * Begin the device flow. Returns a generator-like async iterator the
 * caller can await for state updates: `starting → awaiting-user →
 * approved | denied | expired | error`.
 *
 * The polling timer is owned here; the caller passes an AbortSignal to
 * cancel (e.g. when the user dismisses the modal).
 */
export interface DeviceFlowController {
  state: DeviceFlowState;
  cancel: () => void;
}

export async function startDeviceFlow(
  onState: (state: DeviceFlowState) => void,
): Promise<DeviceFlowController> {
  let cancelled = false;
  const controller: DeviceFlowController = {
    state: { kind: "starting" },
    cancel: () => {
      cancelled = true;
    },
  };
  onState(controller.state);

  // Step 1 — start the flow on the Eve server.
  let started: {
    handle: string;
    userCode: string;
    verificationUri: string;
    verificationUriComplete: string;
    expiresIn: number;
    interval: number;
  };
  try {
    const res = await fetch("/api/auth/cp/device-start", {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };
      throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
    }
    started = (await res.json()) as typeof started;
  } catch (e) {
    const next: DeviceFlowState = {
      kind: "error",
      message: e instanceof Error ? e.message : "Couldn't start sign-in",
    };
    controller.state = next;
    onState(next);
    return controller;
  }

  if (cancelled) return controller;

  // Step 2 — show the code, start polling.
  const awaiting: DeviceFlowState = {
    kind: "awaiting-user",
    userCode: started.userCode,
    verificationUri: started.verificationUri,
    verificationUriComplete: started.verificationUriComplete,
    expiresIn: started.expiresIn,
  };
  controller.state = awaiting;
  onState(awaiting);

  const interval = Math.max(started.interval, 2);
  const deadline = Date.now() + started.expiresIn * 1000;

  const poll = async (): Promise<void> => {
    if (cancelled) return;
    if (Date.now() > deadline) {
      const next: DeviceFlowState = {
        kind: "expired",
        message: "Code expired before approval. Restart sign-in.",
      };
      controller.state = next;
      onState(next);
      return;
    }

    let nextDelay = interval;
    try {
      const res = await fetch("/api/auth/cp/device-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ handle: started.handle }),
      });
      const body = (await res.json()) as
        | { status: "approved" }
        | { status: "pending"; retryAfter: number }
        | { status: "denied" | "expired"; message?: string }
        | { status: "error"; error?: string; message?: string };

      if (cancelled) return;

      if (body.status === "approved") {
        controller.state = { kind: "approved" };
        onState(controller.state);
        return;
      }
      if (body.status === "denied") {
        controller.state = { kind: "denied", message: body.message };
        onState(controller.state);
        return;
      }
      if (body.status === "expired") {
        controller.state = { kind: "expired", message: body.message };
        onState(controller.state);
        return;
      }
      if (body.status === "pending") {
        nextDelay = Math.max(body.retryAfter, 1);
      }
      if (body.status === "error") {
        // Transient — keep polling at the standard interval. If the
        // error persists, the deadline will eventually fire.
        nextDelay = interval;
      }
    } catch {
      // Network blip — back off and try again.
      nextDelay = interval;
    }

    window.setTimeout(() => void poll(), nextDelay * 1000);
  };

  // First poll immediately (handles the rare case where the user
  // approved before this code ran).
  void poll();

  return controller;
}

