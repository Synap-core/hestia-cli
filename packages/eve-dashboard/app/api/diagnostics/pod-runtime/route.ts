import { NextResponse } from "next/server";
import { readPodUserToken, secretsPath } from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";
import { getPodRuntimeContext } from "@/lib/pod-runtime-context";
import { parseKratosFlowResponse, parseSetupStatusResponse } from "@/lib/pod-response-parsers";

export async function GET(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const context = await getPodRuntimeContext(req);
  const token = await readPodUserToken().catch(() => null);
  const setup = await probeSetupStatus(context.trpcBaseUrl);
  const kratos = await probeKratos(context.kratosPublicUrl, context.podBaseUrl);

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
    token: {
      present: Boolean(token?.token),
      expiresAt: token?.expiresAt ?? null,
      userEmail: token?.email ?? null,
    },
    secrets: {
      path: secretsPath(),
      hasSynapApiKey: Boolean(context.secrets?.synap?.apiKey),
      hasDashboardSecret: Boolean(context.secrets?.dashboard?.secret),
      hasPodUserToken: Boolean(token?.token),
    },
    diagnostics: context.diagnostics,
  });
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
