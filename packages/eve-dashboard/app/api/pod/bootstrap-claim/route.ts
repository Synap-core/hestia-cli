/**
 * POST /api/pod/bootstrap-claim
 *
 * Eve-side proxy for the pod's first-admin bootstrap. The dashboard
 * operator (already signed in to local Eve) submits an email; we
 * forward it to the pod's `POST /api/admin/bootstrap/claim` along with
 * the one-time `ADMIN_BOOTSTRAP_TOKEN`. The pod creates a pod-wide
 * invite tied to the email; the user then completes Kratos signup at
 * the pod URL (the dashboard handles redirection).
 *
 * Body: `{ email, name?, role? }`
 *
 * Token resolution order (first match wins):
 *   1. `secrets.pod?.bootstrapToken`           (typed slot — populated by `eve install`)
 *   2. `secrets.synap?.bootstrapToken`         (back-compat alias; tolerated)
 *   3. `process.env.ADMIN_BOOTSTRAP_TOKEN`
 *   4. `process.env.EVE_PROVISIONING_TOKEN`    (back-compat)
 *   5. `resolveProvisioningToken()` from @eve/lifecycle — probes env vars,
 *      `/opt/synap-backend/.env`, and `docker inspect` on the backend
 *      container. Same discovery logic as `eve setup admin`.
 *
 * After a successful claim, the endpoint fires an async auto-provision
 * call (`POST /api/pod/auto-provision`) to mint per-agent Hub Protocol
 * keys for any running components. This ensures AI consumers (OpenWebUI,
 * OpenClaw, Hermes) work immediately without a manual `eve install`.
 *
 * Returns:
 *   • Whatever the upstream returned (status + JSON), with the token
 *     stripped from the request — never echoed back.
 *   • 401 when the operator isn't signed in to Eve.
 *   • 503 `{ error: "no-pod-url" }`         — pod URL not configured.
 *   • 503 `{ error: "no-bootstrap-token" }` — token can't be resolved
 *     anywhere; UI then shows the CLI fallback prominently.
 *
 * See: synap-team-docs/content/team/platform/eve-auth-architecture.mdx
 *      synap-backend/apps/api/src/routers/admin.ts
 */

import { NextResponse } from "next/server";
import { readEveSecrets, resolvePodUrl } from "@eve/dna";
import { resolveProvisioningToken } from "@eve/lifecycle";
import { requireAuth } from "@/lib/auth-server";

interface ClaimBody {
  email?: unknown;
  name?: unknown;
  role?: unknown;
}

function resolveBootstrapToken(secrets: Awaited<ReturnType<typeof readEveSecrets>>): string {
  // 1. `pod.bootstrapToken` — typed slot populated by `eve install`/`eve setup admin`.
  const fromPod = secrets?.pod?.bootstrapToken?.trim() ?? "";
  if (fromPod) return fromPod;

  // 2. Legacy back-compat alias (`synap.bootstrapToken` from old secrets shape).
  const legacy = secrets as unknown as {
    synap?: { bootstrapToken?: string };
  } | null;
  const fromSynap = legacy?.synap?.bootstrapToken?.trim() ?? "";
  if (fromSynap) return fromSynap;

  // 3. Direct env vars.
  const fromEnv =
    process.env.ADMIN_BOOTSTRAP_TOKEN?.trim() ||
    process.env.EVE_PROVISIONING_TOKEN?.trim() ||
    "";
  if (fromEnv) return fromEnv;

  // 4. Rich resolver: probes env vars → .env files → docker inspect.
  //    Mirrors what `eve setup admin` does in the CLI so the dashboard
  //    always has the same discovery power as the CLI.
  return resolveProvisioningToken() ?? "";
}

export async function POST(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const body = (await req.json().catch(() => null)) as ClaimBody | null;
  const email =
    body && typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const name =
    body && typeof body.name === "string" ? body.name.trim() : "";
  const roleRaw =
    body && typeof body.role === "string" ? body.role.trim() : "admin";
  const role: "admin" | "editor" | "viewer" =
    roleRaw === "viewer" || roleRaw === "editor" || roleRaw === "admin"
      ? roleRaw
      : "admin";

  if (!email) {
    return NextResponse.json(
      { error: "email is required" },
      { status: 400 },
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { error: "Invalid email address" },
      { status: 400 },
    );
  }

  const podUrl = await resolvePodUrl(undefined, req.url, req.headers)
  if (!podUrl) {
    return NextResponse.json(
      { error: "no-pod-url" },
      { status: 503 },
    );
  }

  const secrets = await readEveSecrets();
  const token = resolveBootstrapToken(secrets);
  if (!token) {
    return NextResponse.json(
      { error: "no-bootstrap-token" },
      { status: 503 },
    );
  }

  // Traefik now routes `/api/*`, `/trpc/*`, and `/.ory/*` via stripprefix
  // middlewares, so the public pod URL reaches the Hono server for all
  // its routes. Same principle as the standalone Caddy setup.
  const base = podUrl.replace(/\/+$/, "");

  try {
    const res = await fetch(`${base}/api/admin/bootstrap/claim`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ token, email, role }),
      cache: "no-store",
    });

    const upstream = (await res.json().catch(() => null)) as
      | Record<string, unknown>
      | null;

    // Always echo the upstream payload + status — but never the token.
    // We also enrich the success path with a hint URL the UI can use to
    // redirect the operator to the pod's signup page (Kratos consumes
    // the invite tied to the email).
    if (res.ok) {
      const signupUrl = `${base}/auth/registration?invite=${encodeURIComponent(email)}`;

      // Fire-and-forget auto-provision: after a successful claim, mint
      // per-agent Hub Protocol keys for any running components so AI
      // consumers (OpenWebUI, OpenClaw, Hermes) don't need a manual
      // `eve install`. Errors are silently swallowed — the operator can
      // always run the flow manually later.
      void (async () => {
        try {
          await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || ""}/api/pod/auto-provision`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ force: false }),
          });
        } catch { /* auto-provision failure is non-critical */ }
      })();

      return NextResponse.json(
        {
          ...(upstream ?? {}),
          ok: true,
          podUrl: base,
          signupUrl,
          email,
          name: name || undefined,
        },
        { status: res.status },
      );
    }

    return NextResponse.json(
      upstream ?? { error: "Upstream error" },
      { status: res.status },
    );
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? `Pod unreachable: ${err.message}`
            : "Pod unreachable",
      },
      { status: 502 },
    );
  }
}
