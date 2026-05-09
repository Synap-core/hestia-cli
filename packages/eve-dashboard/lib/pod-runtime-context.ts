import {
  readEveSecrets,
  resolvePodUrlDetailed,
  type EveSecrets,
  type PodUrlResolutionDiagnostic,
  type PodUrlResolutionSource,
} from "@eve/dna";

export interface PodRuntimeContext {
  podUrl: string | null;
  podUrlSource: PodUrlResolutionSource;
  eveUrl: string | null;
  secrets: EveSecrets | null;
  kratosPublicUrl: string | null;
  diagnostics: PodUrlResolutionDiagnostic[];
  podBaseUrl: string | null;
  trpcBaseUrl: string | null;
  kratosPublicBaseUrl: string | null;
}

export async function getPodRuntimeContext(req: Request): Promise<PodRuntimeContext> {
  const [secrets, resolution] = await Promise.all([
    readEveSecrets().catch(() => null),
    resolvePodUrlDetailed(undefined, req.url, req.headers),
  ]);

  const podUrl = resolution.podUrl || null;
  const podBaseUrl = podUrl ? podUrl.replace(/\/+$/, "") : null;
  const eveUrl = resolveEveExternalUrl(secrets, podUrl ?? undefined);
  const kratosPublicUrl = podBaseUrl ? `${podBaseUrl}/.ory/kratos/public` : null;
  return {
    podUrl,
    podUrlSource: resolution.source,
    eveUrl,
    secrets,
    kratosPublicUrl,
    diagnostics: resolution.diagnostics,
    podBaseUrl,
    trpcBaseUrl: podBaseUrl ? `${podBaseUrl}/trpc` : null,
    kratosPublicBaseUrl: kratosPublicUrl,
  };
}

function resolveEveExternalUrl(
  secrets: EveSecrets | null,
  podUrl?: string,
): string | null {
  const dashboard = secrets?.dashboard as { publicUrl?: string; port?: number } | undefined;
  const explicit = dashboard?.publicUrl?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const domain = secrets?.domain?.primary?.trim();
  if (domain && domain !== "localhost") {
    const ssl = secrets?.domain?.ssl ?? false;
    return `${ssl ? "https" : "http"}://eve.${domain}`;
  }

  if (podUrl && !isLoopbackUrl(podUrl)) return null;
  return `http://localhost:${dashboard?.port ?? 7979}`;
}

function isLoopbackUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}
