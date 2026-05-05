/**
 * GET /api/invite/[token]
 *
 * Public lookup endpoint for invite metadata. Powers the invite landing
 * page at `/invite/[token]` — the invitee doesn't have an Eve session
 * yet, so this route is intentionally unauthenticated.
 *
 * It hits the pod's `trpc.workspaces.previewInvite` (publicProcedure)
 * directly — no Eve user-channel proxy, no Hub key. The token itself is
 * the capability: anyone holding it is by definition the invitee. The
 * pod returns `null` for unknown tokens and `{ expired: true }` for
 * stale ones; we normalise both into a `{ valid: false, reason }` shape
 * the page can render.
 *
 * Returns:
 *   • 200 `{ valid: true, email, role, type, workspaceName?, expiresAt }`
 *   • 200 `{ valid: false, reason: "expired" | "not-found" | "unreachable" }`
 *   • 503 `{ valid: false, reason: "no-pod-url" }` — operator hasn't pointed
 *     this Eve at a pod yet.
 *
 * Two-channel rule: this is a USER-side flow but the user has no
 * session yet, so we bypass `/api/pod/*` entirely and call the pod's
 * public tRPC URL directly. The procedure is `publicProcedure` so no
 * Authorization header is needed.
 *
 * See: synap-team-docs/content/team/platform/eve-credentials.mdx §6
 */

import { NextResponse } from "next/server";
import { readEveSecrets, resolveSynapUrl } from "@eve/dna";

interface PreviewInviteResult {
  expired?: boolean;
  type?: "workspace" | "pod";
  workspaceName?: string;
  inviterName?: string;
  role?: string;
  email?: string;
  expiresAt?: string;
}

interface TrpcEnvelope<T> {
  result?: { data?: { json?: T } | T };
  error?: { message?: string };
}

function unwrapTrpc<T>(env: TrpcEnvelope<T> | null): T | null {
  if (!env) return null;
  const data = env.result?.data;
  if (data && typeof data === "object" && "json" in data) {
    return (data as { json?: T }).json ?? null;
  }
  return (data as T) ?? null;
}

interface RouteCtx {
  params: Promise<{ token: string }>;
}

export async function GET(_req: Request, ctx: RouteCtx) {
  const { token } = await ctx.params;
  if (!token || typeof token !== "string") {
    return NextResponse.json(
      { valid: false, reason: "not-found" },
      { status: 200 },
    );
  }

  let podUrl = "";
  try {
    const secrets = await readEveSecrets();
    podUrl = resolveSynapUrl(secrets) ?? "";
  } catch {
    // Falls through to the no-pod-url branch.
  }

  if (!podUrl) {
    return NextResponse.json(
      { valid: false, reason: "no-pod-url" },
      { status: 503 },
    );
  }

  const base = podUrl.replace(/\/+$/, "");
  const input = encodeURIComponent(JSON.stringify({ json: { token } }));

  try {
    const res = await fetch(`${base}/trpc/workspaces.previewInvite?input=${input}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json(
        { valid: false, reason: "unreachable" },
        { status: 200 },
      );
    }

    const json = (await res.json().catch(() => null)) as
      | TrpcEnvelope<PreviewInviteResult | null>
      | null;
    const data = unwrapTrpc<PreviewInviteResult | null>(json);

    if (data == null) {
      return NextResponse.json(
        { valid: false, reason: "not-found" },
        { status: 200 },
      );
    }

    if (data.expired) {
      return NextResponse.json(
        { valid: false, reason: "expired" },
        { status: 200 },
      );
    }

    if (!data.email || !data.role || !data.type) {
      // Defensive: older pods that haven't shipped the email field yet.
      return NextResponse.json(
        { valid: false, reason: "unreachable" },
        { status: 200 },
      );
    }

    return NextResponse.json(
      {
        valid: true,
        email: data.email,
        role: data.role,
        type: data.type,
        workspaceName: data.workspaceName ?? null,
        expiresAt: data.expiresAt ?? null,
      },
      { status: 200 },
    );
  } catch {
    return NextResponse.json(
      { valid: false, reason: "unreachable" },
      { status: 200 },
    );
  }
}
