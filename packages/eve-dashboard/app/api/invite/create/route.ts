/**
 * POST /api/invite/create
 *
 * Server-side proxy for the pod's `workspaces.createInvite` tRPC mutation.
 * Requires a valid Eve dashboard session (via `requireAuth`).
 *
 * Body:
 *   {
 *     type: "pod" | "workspace"
 *     email: string
 *     role: "admin" | "editor" | "viewer"
 *     workspaceId?: string   // required when type === "workspace"
 *   }
 *
 * Returns:
 *   200 `{ id, token, expiresAt }`
 *   401 Unauthorized
 *   503 no-pod-url
 *
 * Two-channel rule: this is operator-driven, so it uses the user-channel
 * pattern (tRPC + superjson envelope), NOT the Hub Protocol.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { resolvePodUrl } from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";
import { unwrapTrpc, type TrpcEnvelope } from "@/lib/trpc-utils";

const BodySchema = z.object({
  type: z.enum(["pod", "workspace"]),
  email: z.string().min(1),
  role: z.enum(["admin", "editor", "viewer"]),
  workspaceId: z.string().optional(),
});

interface CreateInviteResult {
  id: string;
  token: string;
  expiresAt: string;
}

interface RouteCtx {
  params: Promise<Record<string, never>>;
}

export async function POST(req: Request, _ctx: RouteCtx) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid_request",
        message: parsed.error?.issues?.[0]?.message ?? "Body is malformed",
      },
      { status: 400 },
    );
  }

  const { type, email, role, workspaceId } = parsed.data;
  const normalisedEmail = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalisedEmail)) {
    return NextResponse.json(
      { error: "Invalid email address" },
      { status: 400 },
    );
  }

  if (type === "workspace" && !workspaceId) {
    return NextResponse.json(
      { error: "workspaceId is required for workspace invites" },
      { status: 400 },
    );
  }

  let podUrl = "";
  try {
    podUrl = (await resolvePodUrl(undefined, req.url, req.headers)) ?? "";
  } catch {
    // Falls through.
  }

  if (!podUrl) {
    return NextResponse.json({ error: "no-pod-url" }, { status: 503 });
  }

  const base = podUrl.replace(/\/+$/, "");
  const input = encodeURIComponent(
    JSON.stringify({
      json: { type, workspaceId, email: normalisedEmail, role },
    }),
  );

  try {
    const res = await fetch(
      `${base}/trpc/workspaces.createInvite?input=${input}`,
      {
        method: "POST",
        headers: { Accept: "application/json" },
        cache: "no-store",
      },
    );

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return NextResponse.json(
        {
          error: "invite_creation_failed",
          message: txt || `Pod returned ${res.status}`,
        },
        { status: res.status },
      );
    }

    const json = await res.json().catch(() => null);
    const data = json ? unwrapTrpc<CreateInviteResult>(json as TrpcEnvelope<CreateInviteResult>) : null;

    if (!data) {
      return NextResponse.json(
        { error: "unexpected_response", message: "Pod returned an empty result" },
        { status: 502 },
      );
    }

    return NextResponse.json(data, { status: 200 });
  } catch {
    return NextResponse.json(
      { error: "pod_unreachable" },
      { status: 502 },
    );
  }
}
