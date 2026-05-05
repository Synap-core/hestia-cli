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
 *   1. `secrets.pod?.bootstrapToken`     (typed slot — populated by `eve install`)
 *   2. `secrets.synap?.bootstrapToken`   (back-compat, not in schema; tolerated)
 *   3. `process.env.ADMIN_BOOTSTRAP_TOKEN`
 *   4. `process.env.EVE_PROVISIONING_TOKEN` (back-compat)
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
import { readEveSecrets, resolveSynapUrl } from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";

interface ClaimBody {
  email?: unknown;
  name?: unknown;
  role?: unknown;
}

function resolveBootstrapToken(secrets: Awaited<ReturnType<typeof readEveSecrets>>): string {
  // `pod.bootstrapToken` is typed in the schema (`@eve/dna` SecretsSchema).
  // `synap.bootstrapToken` is NOT in the schema — tolerated as a back-compat
  // alias from older `.eve/secrets.json` shapes; we fish it out with a cast.
  const fromPod = secrets?.pod?.bootstrapToken?.trim() ?? "";
  if (fromPod) return fromPod;

  const legacy = secrets as unknown as {
    synap?: { bootstrapToken?: string };
  } | null;
  const fromSynap = legacy?.synap?.bootstrapToken?.trim() ?? "";
  if (fromSynap) return fromSynap;

  return (
    process.env.ADMIN_BOOTSTRAP_TOKEN?.trim() ||
    process.env.EVE_PROVISIONING_TOKEN?.trim() ||
    ""
  );
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

  const secrets = await readEveSecrets();
  const podUrl = resolveSynapUrl(secrets);
  if (!podUrl) {
    return NextResponse.json(
      { error: "no-pod-url" },
      { status: 503 },
    );
  }

  const token = resolveBootstrapToken(secrets);
  if (!token) {
    return NextResponse.json(
      { error: "no-bootstrap-token" },
      { status: 503 },
    );
  }

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
