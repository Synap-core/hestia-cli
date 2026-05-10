/**
 * `synap-auth` — Eve dashboard wrapper around `@synap-core/auth`.
 *
 * Two ORTHOGONAL auth layers, each with its own state:
 *
 *   • **CP layer** — Synap account (`synap:session` localStorage +
 *     `.synap.live` cookie). Bearer token issued by the Control Plane.
 *     Optional. Cleared via `signOutOfControlPlane()`.
 *   • **Pod layer** — Per-pod Kratos session (`synap:pods` map keyed by
 *     pod URL). One entry per pod the user has connected to. Cleared
 *
 * ## iFrame postMessage handshake
 *
 * Apps embedded in an Eve `AppPane` receive their session via postMessage
 * because iFrame origins cannot read the parent's localStorage and
 * cross-origin cookies are blocked by SameSite=Lax. The protocol:
 *
 *   Phase 1 — proactive push (AppPane `onLoad`):
 *     Eve  →  app : { type: "synap:auth", session: SharedSession }
 *
 *   Phase 2 — on-demand pull (if the app misses phase 1):
 *     app  →  Eve : { type: "synap:ready" }
 *     Eve  →  app : { type: "synap:auth", session: SharedSession }
 *
 * Security: Eve only posts sessions to origins in `isAllowedEmbedOrigin`
 * (`@eve/dna`), always using the exact target origin, never `"*"`.
 *
 * Child-side receiver pattern (in each embedded app):
 *
 *   ```ts
 *   // Request session if not already stored
 *   window.parent.postMessage({ type: "synap:ready" }, "*");
 *   window.addEventListener("message", (e) => {
 *     if (e.data?.type !== "synap:auth") return;
 *     const { session } = e.data as { session: SharedSession };
 *     if (session?.sessionToken) storeSharedSession(session);
 *   });
 *   ```
 *     per-pod via `signOutOfPod(podUrl)`.
 *
 * A user may have CP only, pod only, both, or neither. Sign-out from
 * one layer **does not** affect the other.
 *
 * Disk persistence (`~/.eve/secrets.json`) is a third concern:
 *   • `cp.userSession` — host owner's CP token (for the `eve` CLI).
 *     Single-writer, owner-only. Synced via `POST /api/auth/sync`.
 *
 * Pod sessions are NEVER persisted by Eve. The operator's
 * `ory_kratos_session` cookie (set at the parent domain by Kratos)
 * is the credential. Eve forwards it to the pod via `/api/pod/*` and
 * mirrors it into `synap:pods` for cross-app surfaces, but holds no
 * disk copy.
 *
 * NOTE: `@synap-core/auth` is published to npm. Until v1.1.0 is
 * published + installed, the new pod-session helpers
 * (`storePodSession`, `getAllPodSessions`, `signOutOfPod`,
 * `signOutOfAllPods`, `connectDirectLogin`) won't resolve. That
 * type-check error is expected and acceptable.
 */

import {
  createAuthClient,
  createProxyTransport,
  createSessionStorage,
  isTwoFactorRequired,
  storeSharedSession,
  getSharedSession,
  clearSharedSession,
  // 1.1.0 pod-session helpers
  storePodSession,
  getPodSession,
  getAllPodSessions,
  signOutOfPod as signOutOfPodCore,
  signOutOfAllPods,
} from "@synap-core/auth";
import type {
  CPSession,
  PodInfo,
  PodSession,
  PodSessionMap,
  SharedSession,
  StoredPodSession,
} from "@synap-core/auth";

// ─── Configuration ──────────────────────────────────────────────────────────

const CP_URL =
  process.env.NEXT_PUBLIC_CP_API_URL ||
  process.env.NEXT_PUBLIC_CP_BASE_URL ||
  "https://api.synap.live";

/**
 * Single CP auth client.
 *
 * Transport: `createProxyTransport` routes all CP calls through Eve's own
 * Next.js server (`/api/auth/cp/…` → `https://api.synap.live/…`).
 * This avoids CORS: Eve dashboards run on arbitrary custom domains
 * (e.g. eve.team.thearchitech.xyz) that are not in the CP's
 * `trustedOrigins` list. Server-to-server has no CORS constraint.
 *
 * Pod calls are proxied through `/api/pod/…` using the same pattern.
 *
 * Storage: sessionStorage — token doesn't survive a tab close.
 * The host secrets file (`~/.eve/secrets.json` → `cp.userSession`) is
 * the durable record written by `POST /api/auth/sync` after sign-in.
 */
export const authClient = createAuthClient({
  cpUrl: CP_URL,
  transport: createProxyTransport({
    cpProxyBase: "/api/auth/cp",
    podProxyBase: "/api/pod",
  }),
  storage:
    typeof window === "undefined"
      ? // Server-render fallback — never actually written to.
        {
          get: async () => null,
          set: async () => {},
          delete: async () => {},
        }
      : createSessionStorage(),
});

// ─── CP-only host bridge ────────────────────────────────────────────────────
//
// `syncSessionToHost` is the CP-only persistence path. It writes the
// CP user-session into `~/.eve/secrets.json` so the on-host CLI can
// act as the user. Pod sessions DO NOT flow through here — they are
// persisted by the pod-signin route's first-write-wins logic.

async function syncSessionToHost(session: CPSession): Promise<void> {
  try {
    // Wire shape mirrors `app/api/auth/sync/route.ts` Zod schema.
    await fetch("/api/auth/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        action: "set",
        session: {
          token: session.token,
          userId: session.userId,
          email: session.email,
          name: session.name,
          avatarUrl: session.avatarUrl,
          expiresAt: session.expiresAt,
          twoFactorEnabled: session.twoFactorEnabled,
          issuedAt: new Date().toISOString(),
        },
      }),
    });
  } catch {
    // Host sync is best-effort — the in-memory session still works
    // for this tab. The next page load will re-prompt if
    // /api/auth/sync didn't catch up.
  }
}

async function clearSessionFromHost(): Promise<void> {
  try {
    await fetch("/api/auth/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ action: "clear" }),
    });
  } catch {
    /* noop */
  }
}

function toSharedSession(session: CPSession): SharedSession {
  return {
    podUrl: "", // CP-only — pod connect happens later
    sessionToken: session.token,
    workspaceId: null,
    userId: session.userId,
    userName: session.name ?? "",
  };
}

// ─── CP layer (sign in / sign up / sign out) ───────────────────────────────

export type CPSignInResult =
  | { kind: "signed-in"; session: CPSession }
  | { kind: "two-factor-required"; email: string };

export async function signInToControlPlane(
  email: string,
  password: string,
): Promise<CPSignInResult> {
  const result = await authClient.signInToCP(email, password);
  if (isTwoFactorRequired(result)) {
    return { kind: "two-factor-required", email: result.email };
  }
  storeSharedSession(toSharedSession(result));
  await syncSessionToHost(result);
  return { kind: "signed-in", session: result };
}

export async function signUpToControlPlane(
  email: string,
  password: string,
  name: string,
): Promise<CPSession> {
  const session = await authClient.signUpToCP(email, password, name);
  storeSharedSession(toSharedSession(session));
  await syncSessionToHost(session);
  return session;
}

/**
 * Verify the TOTP code for the pending CP sign-in. On success refetches
 * the session so we get the user profile fields populated.
 */
export async function verifyTotpLogin(
  code: string,
): Promise<{ ok: true; session: CPSession } | { ok: false; error: string }> {
  const result = await authClient.verifyTotpLogin(code);
  if (!result.ok) return { ok: false, error: result.error ?? "Invalid code." };
  const session = await authClient.checkCPSession();
  if (!session)
    return { ok: false, error: "Verification succeeded but session is missing." };
  storeSharedSession(toSharedSession(session));
  await syncSessionToHost(session);
  return { ok: true, session };
}

/**
 * Sign out of the Control Plane only. Pod sessions are NOT touched —
 * a user may stay signed into their pod after dropping their CP
 * account (Mode B / self-hosted).
 */
export async function signOutOfControlPlane(): Promise<void> {
  try {
    await authClient.signOutOfCP();
  } catch {
    /* even if CP logout fails, drop the local session below */
  }
  clearSharedSession();
  await clearSessionFromHost();
}

export async function checkCpSession(): Promise<CPSession | null> {
  return authClient.checkCPSession();
}

export async function fetchUserPods(): Promise<PodInfo[]> {
  return authClient.fetchPodsForConnect();
}

// ─── Pod layer (per-pod Kratos sessions) ────────────────────────────────────

/**
 * Connect to `podUrl` using the user's CP session. Triggers the CP
 * handshake → pod handshake flow and persists the resulting Kratos
 * session into the `synap:pods` map (handled inside `@synap-core/auth`
 * 1.1.0+).
 *
 * Requires a CP session — call after `signInToControlPlane` succeeds.
 */
export async function connectToPodWithCP(podUrl: string): Promise<PodSession> {
  const base = podUrl.replace(/\/+$/, "");
  if (base.startsWith("http://") && !/localhost|127\.0\.0\.1/.test(base)) {
    throw new Error("Refusing insecure pod connection. Pod URL must use HTTPS.");
  }
  // `connectViaCPHandshake` in 1.1.0 auto-persists into `synap:pods`.
  return authClient.connectViaCPHandshake(base);
}

// NOTE: a `connectToPodDirect()` helper used to live here, wrapping
// `connectDirectLogin` from `@synap-core/auth`. That symbol is not
// exported from the 1.1.0 barrel — direct-Kratos signups for Eve go
// through `POST /api/pod/bootstrap-claim` (server-side) instead, and
// the JWT-Bearer flow handles re-signin. So this helper has been
// removed; callers that need a direct-Kratos browser-side login
// should add a thin wrapper around `authClient.connectViaCPHandshake`
// or a new server route.

/**
 * Read the current pod session for `podUrl` from the `synap:pods` map,
 * or `null` if not connected. Returns a `StoredPodSession` (storage
 * record), not the auth-client `PodSession`.
 */
export function getCurrentPodSession(podUrl: string): StoredPodSession | null {
  if (typeof window === "undefined") return null;
  return getPodSession(podUrl);
}

/**
 * Sign out of `podUrl`. Removes the entry from `synap:pods` AND asks
 * the dashboard to initiate a Kratos browser-flow logout (which
 * clears the parent-domain `ory_kratos_session` cookie).
 *
 * Idempotent — safe to call when no session exists.
 */
export async function signOutOfPod(podUrl: string): Promise<void> {
  // Browser-side: drop the entry from `synap:pods` immediately so the
  // gate state updates in this tab.
  signOutOfPodCore(podUrl);

  // Server-side: ask Eve to start a Kratos logout flow and clear the
  // Kratos cookie defensively. If Kratos returned a logout_url, the
  // browser navigates there to finalize.
  try {
    const res = await fetch("/api/auth/pod-signout", {
      method: "POST",
      credentials: "include",
    });
    const data = (await res
      .json()
      .catch(() => null)) as { logoutUrl?: string } | null;
    if (data?.logoutUrl && typeof window !== "undefined") {
      window.location.href = data.logoutUrl;
    }
  } catch {
    /* non-fatal — browser state is already updated */
  }
}

/**
 * Wrapper around `@synap-core/auth`'s `signOutOfAllPods()` that also
 * triggers a Kratos browser-flow logout to clear the parent-domain
 * cookie. Use for "sign out everywhere".
 */
export async function signOutOfAllPodsAndClearDisk(): Promise<void> {
  signOutOfAllPods();
  try {
    const res = await fetch("/api/auth/pod-signout", {
      method: "POST",
      credentials: "include",
    });
    const data = (await res
      .json()
      .catch(() => null)) as { logoutUrl?: string } | null;
    if (data?.logoutUrl && typeof window !== "undefined") {
      window.location.href = data.logoutUrl;
    }
  } catch {
    /* non-fatal */
  }
}

/**
 * Legacy alias preserved for callers that still expect the old
 * `handshakeToPod` shape. Returns the data the `pod-pair` flow needs
 * (podUrl + sessionToken + workspaceId).
 *
 * @deprecated use `connectToPodWithCP` directly when possible.
 */
export async function handshakeToPod(
  podUrl: string,
): Promise<{ podUrl: string; sessionToken: string; workspaceId: string }> {
  const session = await connectToPodWithCP(podUrl);
  return {
    podUrl: session.podUrl,
    sessionToken: session.sessionToken,
    workspaceId: session.activeWorkspaceId ?? session.workspaceIds?.[0] ?? "",
  };
}

// ─── Re-exports & helpers ───────────────────────────────────────────────────

export {
  getSharedSession,
  clearSharedSession,
  isTwoFactorRequired,
  storePodSession,
  getPodSession,
  getAllPodSessions,
};
export type {
  CPSession,
  PodInfo,
  PodSession,
  PodSessionMap,
  SharedSession,
  StoredPodSession,
};

/**
 * "Self-hosted mode" marker. When the operator authenticates via the
 * pod-local Kratos flow (no CP account), we still want
 * `EveAccountGate` to let them through. We piggy-back on the shared
 * session shape with an explicit marker so the gate can detect it.
 *
 * NOTE: with the orthogonal-layer model, this marker is now mostly
 * historical — the gate also accepts "no CP, has pod session for
 * local pod" as Mode B. We keep the marker for back-compat with
 * legacy installs that wrote `mode: "self-hosted"` into the shared
 * session before the split.
 */
export interface SelfHostedSession extends SharedSession {
  mode: "self-hosted";
}

export function isSelfHostedSession(s: unknown): s is SelfHostedSession {
  return (
    typeof s === "object" &&
    s !== null &&
    (s as { mode?: string }).mode === "self-hosted"
  );
}

export function storeSelfHostedSession(podUrl: string, email: string): void {
  storeSharedSession({
    podUrl,
    sessionToken: "",
    workspaceId: null,
    userId: "",
    userName: email,
    // The shared-session type doesn't model `mode` — store it as an
    // extra field; consumers narrow with `isSelfHostedSession`.
    ...({ mode: "self-hosted" } as Record<string, unknown>),
  } as SharedSession);
}
