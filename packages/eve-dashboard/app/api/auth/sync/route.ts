/**
 * POST /api/auth/sync — persist a CP user session into the host secrets file.
 *
 * Eve's browser surface signs the user into the Synap Control Plane via
 * `@synap-core/auth`. The resulting `CPSession` lives in browser storage
 * by default. This route lets the browser hand the session to the host
 * server so the on-host CLI / Eve daemon can act AS the user without a
 * second sign-in flow.
 *
 * ──────────────────────────────────────────────────────────────────────
 * Multi-user / owner-only model
 * ──────────────────────────────────────────────────────────────────────
 *
 * `~/.eve/secrets.json` is mode 0600 — readable only by the host owner.
 * The on-host CLI runs under that same uid. Persisting another user's
 * session into that file would silently grant the owner access to the
 * second user's CP account; that's a leak, not a feature.
 *
 * So this route enforces a "first user wins" rule:
 *
 *   • If `cp.userSession` is empty → write the incoming session. That
 *     user becomes the canonical "host owner" for the on-host CLI.
 *   • If `cp.userSession` is set AND the incoming `userId` matches →
 *     refresh the slot (token rotation, expiry update, profile change).
 *   • If `cp.userSession` is set AND the incoming `userId` is DIFFERENT
 *     → no-op. We return `{ ok: true, skipped: "host-owner-already-set" }`
 *     so the browser sign-in flow continues; the second user's session
 *     stays in their browser only.
 *
 * The eve-session cookie still gates this route (the request still has
 * to come from a browser that holds a valid local Eve dashboard
 * session). The cookie proves "this request reached the on-host
 * dashboard"; the user-id check ensures we don't overwrite the owner's
 * disk slot.
 *
 * Idempotent — calling with the same session multiple times is safe.
 *
 * Body: `{ action: "set", session } | { action: "clear" }`
 *
 * Returns:
 *   200 `{ ok: true }`                                      — written.
 *   200 `{ ok: true, skipped: "host-owner-already-set" }`   — no-op.
 *   400 `{ error: "invalid_request", message }`             — malformed body.
 *   401 `{ error: "Unauthorized" }`                         — missing eve-session.
 *   500 `{ error: "write_failed", message }`                — disk failure.
 *
 * See: synap-team-docs/content/team/platform/eve-credentials.mdx
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  clearCpUserSession,
  readCpUserSession,
  writeCpUserSession,
  type CpUserSession,
} from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";

const SessionPayloadSchema = z.object({
  token: z.string().min(1),
  userId: z.string().min(1),
  email: z.string().min(1),
  name: z.string().optional(),
  avatarUrl: z.string().optional(),
  expiresAt: z.string().optional(),
  twoFactorEnabled: z.boolean().optional(),
  // Caller may omit; we stamp `new Date().toISOString()` server-side.
  issuedAt: z.string().optional(),
});

const BodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("set"),
    session: SessionPayloadSchema,
  }),
  z.object({
    action: z.literal("clear"),
  }),
]);

export async function POST(req: Request) {
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

  if (parsed.data.action === "clear") {
    try {
      await clearCpUserSession();
      return NextResponse.json({ ok: true });
    } catch (err) {
      return NextResponse.json(
        {
          error: "write_failed",
          message: err instanceof Error ? err.message : "Unknown error",
        },
        { status: 500 },
      );
    }
  }

  // action === "set"
  const incoming: CpUserSession = {
    token: parsed.data.session.token,
    userId: parsed.data.session.userId,
    email: parsed.data.session.email,
    name: parsed.data.session.name,
    avatarUrl: parsed.data.session.avatarUrl,
    expiresAt: parsed.data.session.expiresAt,
    twoFactorEnabled: parsed.data.session.twoFactorEnabled,
    issuedAt: parsed.data.session.issuedAt ?? new Date().toISOString(),
  };

  // Owner gate — only the FIRST signed-in user (or the same user
  // refreshing) gets persisted. Different user → no-op + ok.
  let existing: CpUserSession | null = null;
  try {
    existing = await readCpUserSession();
  } catch {
    // Treat read failure as "no existing session" — the next write
    // will surface a real error if the disk is broken.
    existing = null;
  }
  if (existing && existing.userId && existing.userId !== incoming.userId) {
    return NextResponse.json({
      ok: true,
      skipped: "host-owner-already-set",
    });
  }

  try {
    await writeCpUserSession(incoming);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      {
        error: "write_failed",
        message: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
