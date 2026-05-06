/**
 * `synap-auth` — Eve dashboard wrapper around `@synap-core/auth`.
 *
 * Single module-level `AuthClient` configured for the CP this Eve points
 * at. Mirrors `apps/hub/lib/auth.ts` shape but writes the resulting
 * session into BOTH:
 *   • shared cross-app storage (`storeSharedSession`) so other Synap
 *     surfaces on `.synap.live` (or `localhost`) pick it up automatically.
 *   • Eve's host secrets file via `POST /api/auth/sync` so the
 *     dashboard's server-side routes can build authenticated requests
 *     without re-prompting the user.
 *
 * The browser holds the CP Bearer token only as long as the tab is
 * alive — the host file is the durable record. Sign-out clears both.
 *
 * NOTE: `@synap-core/auth` is published to npm. Until the user runs
 * `pnpm install` after publishing, the import will fail to resolve.
 * That single error is expected and acceptable.
 */

import {
  createAuthClient,
  createFetchTransport,
  createSessionStorage,
  isTwoFactorRequired,
  storeSharedSession,
  getSharedSession,
  clearSharedSession,
} from "@synap-core/auth";
import type {
  CPSession,
  PodInfo,
  SharedSession,
} from "@synap-core/auth";

// ─── Configuration ──────────────────────────────────────────────────────────

const CP_URL =
  process.env.NEXT_PUBLIC_CP_API_URL ||
  process.env.NEXT_PUBLIC_CP_BASE_URL ||
  "https://api.synap.live";

/**
 * Origin sent on Better Auth requests. Eve dashboards run anywhere
 * (loopback, custom domain, behind a tunnel) so we read it dynamically
 * at call time. The value must be in the CP's `trustedOrigins` list —
 * Eve loopback origins are allow-listed by default.
 */
function appOrigin(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return window.location.origin;
}

/**
 * Single CP auth client. Uses `sessionStorage` so the token doesn't
 * survive a tab close (the host secrets file is the durable record).
 */
export const authClient = createAuthClient({
  cpUrl: CP_URL,
  origin: appOrigin(),
  transport: createFetchTransport(),
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

// ─── Auth-sync bridge ──────────────────────────────────────────────────────

/**
 * Persist the CP session into Eve's host secrets file so server-side
 * routes can build authenticated requests without re-prompting. The
 * route hashes the bearer token and stores it scoped to the dashboard
 * cookie, matching how OAuth/device-flow tokens are persisted.
 */
async function syncSessionToHost(session: CPSession): Promise<void> {
  try {
    // Wire shape mirrors `app/api/auth/sync/route.ts` Zod schema:
    // `{ token, userId, email, name?, avatarUrl?, expiresAt?,
    //   twoFactorEnabled?, issuedAt? }`. Stripping unrelated fields
    // keeps the payload minimal — anything extra would be rejected
    // by `safeParse`.
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

// ─── Public API (mirrors apps/hub/lib/auth.ts) ─────────────────────────────

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

export async function handshakeToPod(
  podUrl: string,
): Promise<{ podUrl: string; sessionToken: string; workspaceId: string }> {
  const base = podUrl.replace(/\/+$/, "");
  if (base.startsWith("http://") && !/localhost|127\.0\.0\.1/.test(base)) {
    throw new Error("Refusing insecure pod connection. Pod URL must use HTTPS.");
  }
  const session = await authClient.connectViaCPHandshake(base);
  return {
    podUrl: session.podUrl,
    sessionToken: session.sessionToken,
    workspaceId: session.activeWorkspaceId ?? session.workspaceIds?.[0] ?? "",
  };
}

// ─── Re-exports & helpers ───────────────────────────────────────────────────

export { getSharedSession, clearSharedSession, isTwoFactorRequired };
export type { CPSession, PodInfo, SharedSession };

/**
 * "Self-hosted mode" marker. When the operator authenticates via the
 * pod-local Kratos flow (no CP account), we still want
 * `EveAccountGate` to let them through. We piggy-back on the shared
 * session shape with an explicit marker so the gate can detect it.
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
