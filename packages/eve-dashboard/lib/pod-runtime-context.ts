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

/**
 * Resolve the dashboard's OWN external base URL for building absolute redirects
 * (Kratos `return_to`, post-login landing, error pages).
 *
 * Resolution order:
 *   1. `x-forwarded-host` / `Host` — but ONLY when it names a routable external
 *      domain. A reverse proxy that doesn't preserve Host (e.g. Caddy fronting
 *      the container) leaves us with the internal bind address — `0.0.0.0:3000`,
 *      `127.0.0.1:3000`, `localhost:3000` — which is a dead URL for the browser.
 *   2. `context.eveUrl` — the dashboard's known external URL (`eve.<domain>`)
 *      derived from secrets. Deterministic; immune to proxy header mangling.
 *   3. `req.url` — last resort (internal address; only correct in local dev).
 *
 * This is the canonical source for self-referential redirects. Never trust the
 * Host header alone: it depends on every proxy in the chain preserving it.
 */
export function resolveExternalBaseUrl(
  req: Request,
  context: Pick<PodRuntimeContext, "eveUrl">,
): string {
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const candidate = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (candidate && isRoutableHost(candidate)) {
    return `${proto}://${candidate}`;
  }
  if (context.eveUrl) return context.eveUrl.replace(/\/+$/, "");
  return req.url;
}

/** True when a Host header names a routable external domain (not a bind address). */
function isRoutableHost(hostHeader: string): boolean {
  const hostname = hostHeader
    .trim()
    .toLowerCase()
    .replace(/^\[/, "")
    .replace(/\]?(:\d+)?$/, "");
  if (!hostname) return false;
  return !["0.0.0.0", "127.0.0.1", "localhost", "::1", "::"].includes(hostname);
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
