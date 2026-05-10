import { NextResponse } from "next/server";
import { secretsPath } from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";
import { getPodRuntimeContext } from "@/lib/pod-runtime-context";
import { parseKratosFlowResponse, parseSetupStatusResponse } from "@/lib/pod-response-parsers";

function extractKratosSessionCookie(req: Request): string | null {
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  const match = raw.match(/(?:^|;\s*)ory_kratos_session=([^;]+)/);
  return match ? match[1] : null;
}

export async function GET(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const context = await getPodRuntimeContext(req);
  const setup = await probeSetupStatus(context.trpcBaseUrl);
  const kratos = await probeKratos(context.kratosPublicUrl, context.podBaseUrl);
  const session = await probeKratosSession(
    context.kratosPublicUrl,
    extractKratosSessionCookie(req),
  );

  return NextResponse.json({
    pod: {
      url: context.podBaseUrl,
      source: context.podUrlSource,
    },
    eve: {
      url: context.eveUrl,
    },
    setup,
    kratos,
    session,
    secrets: {
      path: secretsPath(),
      hasSynapApiKey: Boolean(context.secrets?.synap?.apiKey),
      hasDashboardSecret: Boolean(context.secrets?.dashboard?.secret),
    },
    diagnostics: context.diagnostics,
  });
}

interface KratosWhoamiBody {
  expires_at?: string;
  identity?: { traits?: { email?: string } };
}

async function probeKratosSession(
  kratosPublicUrl: string | null,
  sessionCookie: string | null,
) {
  if (!kratosPublicUrl) {
    return { present: false, reason: "no-pod-url", expiresAt: null, userEmail: null };
  }
  if (!sessionCookie) {
    return { present: false, reason: "no-cookie", expiresAt: null, userEmail: null };
  }
  try {
    const res = await fetch(`${kratosPublicUrl}/sessions/whoami`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Cookie: `ory_kratos_session=${sessionCookie}`,
      },
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        present: false,
        reason: `whoami-${res.status}`,
        expiresAt: null,
        userEmail: null,
      };
    }
    const body = (await res.json().catch(() => null)) as KratosWhoamiBody | null;
    return {
      present: true,
      reason: null,
      expiresAt: body?.expires_at ?? null,
      userEmail: body?.identity?.traits?.email ?? null,
    };
  } catch (err) {
    return {
      present: false,
      reason: err instanceof Error ? err.message : "fetch-exception",
      expiresAt: null,
      userEmail: null,
    };
  }
}

async function probeSetupStatus(trpcBaseUrl: string | null) {
  if (!trpcBaseUrl) {
    return { ok: false, reason: "no-pod-url", status: null, parsed: null };
  }

  try {
    const res = await fetch(`${trpcBaseUrl}/setup.status`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const body = await res.json().catch(() => null);
    return {
      ok: res.ok,
      status: res.status,
      parsed: res.ok ? parseSetupStatusResponse(body) : null,
      reason: res.ok ? null : `upstream-${res.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      status: null,
      parsed: null,
      reason: err instanceof Error ? err.message : "fetch-exception",
    };
  }
}

async function probeKratos(kratosPublicUrl: string | null, podBaseUrl: string | null) {
  if (!kratosPublicUrl) {
    return {
      ok: false,
      status: null,
      actionOrigin: null,
      actionMatchesPodOrigin: false,
      reason: "no-pod-url",
    };
  }

  try {
    const res = await fetch(`${kratosPublicUrl}/self-service/login/api`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const body = await res.json().catch(() => null);
    const flow = res.ok ? parseKratosFlowResponse(body) : null;
    const action = flow?.ui?.action;
    const actionOrigin = action ? safeOrigin(action) : null;
    const podOrigin = podBaseUrl ? safeOrigin(podBaseUrl) : null;
    return {
      ok: res.ok && Boolean(flow?.id),
      status: res.status,
      actionOrigin,
      actionMatchesPodOrigin: Boolean(actionOrigin && podOrigin && actionOrigin === podOrigin),
      reason: res.ok ? null : `upstream-${res.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      status: null,
      actionOrigin: null,
      actionMatchesPodOrigin: false,
      reason: err instanceof Error ? err.message : "fetch-exception",
    };
  }
}

function safeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}
