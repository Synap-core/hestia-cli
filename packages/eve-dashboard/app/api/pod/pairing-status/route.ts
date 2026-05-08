/**
 * GET /api/pod/pairing-status
 *
 * Single source of truth for the dashboard UI to know what stage the
 * operator is at in the pod sign-in flow. Powers `usePodPairing()` and
 * the home stat-pill cluster's "pair your pod" CTA swap.
 *
 * States:
 *   • `unconfigured` — Eve doesn't know a pod URL yet
 *     (no `pod.url` and no `synap.apiUrl`)
 *   • `paired`       — `pod.userToken` exists and is comfortably valid
 *     (>60s before expiry)
 *   • `needs-refresh`— `pod.userToken` exists but expired / about to.
 *     The proxy auto-mints when given an email, so the UX still treats
 *     this as "paired-ish" — we surface it for diagnostics.
 *   • `stale-cred`   — pod URL set, no userToken, AND no `userEmail`
 *     cached; we have nothing to mint with, full email prompt needed.
 *   • `unpaired`     — pod URL set, no userToken, but `userEmail` is
 *     cached so a one-click re-sign-in is possible.
 *
 * The token itself is NEVER returned. Only metadata the UI needs.
 *
 * See: synap-team-docs/content/team/platform/eve-credentials.mdx
 */

import { NextResponse } from "next/server";
import { readEveSecrets, resolvePodUrl } from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";

export type PairingStateApi =
  | "unconfigured"
  | "unpaired"
  | "paired"
  | "needs-refresh"
  | "stale-cred";

export interface PairingStatusResponse {
  state: PairingStateApi;
  /** Email cached in `pod.userEmail` (if any) — surfaces re-sign-in copy. */
  userEmail?: string;
  /** Pod base URL the operator is paired with (helpful diagnostic). */
  podUrl?: string;
  /** ISO-8601 — only present when a token is cached. */
  expiresAt?: string;
}

export async function GET(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  let secrets: Awaited<ReturnType<typeof readEveSecrets>> = null;
  try {
    secrets = await readEveSecrets();
  } catch {
    // Fall through — `unconfigured` is the safest answer when we can't
    // read secrets at all (volume mount missing on a fresh container).
  }

  let podUrl: string | undefined;
  try {
    podUrl = await resolvePodUrl(undefined, req.url);
  } catch {
    // Falls through — `unconfigured` is the safest answer when we can't
    // resolve a pod URL (volume mount missing on a fresh container).
  }

  if (!podUrl) {
    return NextResponse.json<PairingStatusResponse>({
      state: "unconfigured",
    });
  }

  const userToken = secrets?.pod?.userToken;
  const userTokenExpiresAt = secrets?.pod?.userTokenExpiresAt;
  const userEmail = secrets?.pod?.userEmail;

  // No token at all — distinguish "we know your email" from "stale"
  // (no email cached either). The latter needs the full prompt; the
  // former is one-click re-sign-in.
  if (!userToken || !userTokenExpiresAt) {
    return NextResponse.json<PairingStatusResponse>({
      state: userEmail ? "unpaired" : "stale-cred",
      userEmail,
      podUrl,
    });
  }

  const expiresMs = Date.parse(userTokenExpiresAt);
  if (Number.isNaN(expiresMs)) {
    // Garbage timestamp — treat as needing a refresh so the UI nudges.
    return NextResponse.json<PairingStatusResponse>({
      state: "needs-refresh",
      userEmail,
      podUrl,
      expiresAt: userTokenExpiresAt,
    });
  }

  const safeUntil = expiresMs - 60_000;
  if (safeUntil <= Date.now()) {
    return NextResponse.json<PairingStatusResponse>({
      state: "needs-refresh",
      userEmail,
      podUrl,
      expiresAt: userTokenExpiresAt,
    });
  }

  return NextResponse.json<PairingStatusResponse>({
    state: "paired",
    userEmail,
    podUrl,
    expiresAt: userTokenExpiresAt,
  });
}
