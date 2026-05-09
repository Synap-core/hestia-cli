import { resolvePodUrl } from "@eve/dna";

export interface PodRuntimeContext {
  podUrl: string;
  podBaseUrl: string;
  trpcBaseUrl: string;
  kratosPublicBaseUrl: string;
}

export async function getPodRuntimeContext(req: Request): Promise<PodRuntimeContext | null> {
  const podUrl = await resolvePodUrl(undefined, req.url, req.headers);
  if (!podUrl) return null;

  const podBaseUrl = podUrl.replace(/\/+$/, "");
  return {
    podUrl,
    podBaseUrl,
    trpcBaseUrl: `${podBaseUrl}/trpc`,
    kratosPublicBaseUrl: `${podBaseUrl}/.ory/kratos/public`,
  };
}
