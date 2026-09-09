/**
 * Pod AI-provider client — the ONE door Eve uses to write the pod's
 * `ai_providers` table.
 *
 * WHY THIS EXISTS. Eve had two provider commands with the same noun and
 * different behaviour: `eve brain providers add` wrote the pod's canonical
 * table over Hub REST, while `eve ai providers add` accepted only a CLOSED
 * four-vendor enum and wrote nothing but local secrets + a host `.env`. The
 * obvious one to type was the one that could not register a custom
 * OpenAI-compatible endpoint at all. Both now call this.
 *
 * THE POD IS THE SOURCE OF TRUTH. `ai_providers` → `pushProvidersToIS()` is the
 * canonical path by which the Intelligence Service learns its providers. Eve's
 * `.env` wiring is a BOOTSTRAP path (see `wire-ai.ts`), not a second authority:
 * both used to write the same in-memory IS registry, last writer winning, and
 * neither could see what the other had done.
 *
 * A PROPOSAL IS NOT A FAILURE, AND IT IS NOT A SUCCESS EITHER. Provider writes
 * are governed on the pod: an agent-attributed write returns HTTP 202 with
 * `{status:"proposed"}` and NOTHING has been written yet. The old code reported
 * "✓ saved and synced to IS" on any 2xx, which would have turned a pending
 * proposal into a confident lie — the caller would then wire local containers
 * against a provider the pod does not have. This client returns a discriminated
 * result so a caller cannot accidentally treat the two alike.
 */

export interface PodProviderModel {
  id: string;
  tier?: "free" | "balanced" | "advanced" | "complex";
  contextWindow?: number;
  supportsTools?: boolean;
  supportsJson?: boolean;
  costPer1MInput?: number;
  costPer1MOutput?: number;
}

export interface PodProviderUpsert {
  providerId: string;
  name: string;
  baseUrl: string;
  apiKeyEnvVar?: string;
  apiKey?: string;
  enabled?: boolean;
  priority?: number;
  tags?: string[];
  models?: PodProviderModel[];
}

export type PodProviderResult =
  | { status: "applied"; providerId: string }
  | { status: "proposed"; providerId: string; proposalId: string; message: string };

export class PodProviderError extends Error {
  constructor(
    message: string,
    readonly httpStatus?: number
  ) {
    super(message);
    this.name = "PodProviderError";
  }
}

function hubUrl(podUrl: string, path: string): string {
  return `${podUrl.replace(/\/$/, "")}/api/hub/${path}`;
}

/**
 * Turn a pod failure into something the operator can act on.
 *
 * The 403 case is the one that matters: provider writes now require the narrow
 * `providers.write` scope, which is deliberately NOT in the default agent
 * bundle. A bare "Pod responded 403" would send someone hunting for a broken
 * key when the actual answer is "this key was never granted that scope".
 */
async function raise(res: Response, providerId: string, url: string): Promise<never> {
  const text = await res.text().catch(() => "");
  if (res.status === 403 && text.includes("providers.write")) {
    throw new PodProviderError(
      `The pod refused this write: your Eve key does not hold the "providers.write" scope.\n` +
        `  Writing an AI provider sets the URL your pod sends every prompt to, so it is\n` +
        `  deliberately not part of the default agent scope bundle.\n` +
        `  Re-provision Eve's key with that scope, then retry.`,
      403
    );
  }
  if (res.status === 404) {
    // Do NOT assert a cause here. A 404 means "nothing at that URL", which is
    // most often the WRONG URL — an off-host public URL used on-host, a stale
    // `synap.apiUrl`, or a proxy that does not route this path — and only
    // sometimes an old pod. Naming the URL that was tried is what makes the
    // difference visible; guessing "old build" sent one debugging session
    // down the wrong path entirely.
    throw new PodProviderError(
      `No /ai-providers route at ${url} (HTTP 404).\n` +
        `  The pod may be reachable at a different address than the one Eve resolved,\n` +
        `  or it predates the provider door. Check: curl -s -o /dev/null -w '%{http_code}' ${url}`,
      404
    );
  }
  throw new PodProviderError(
    `Pod responded ${res.status} for provider "${providerId}" at ${url}: ${text}`,
    res.status
  );
}

/**
 * Create or update a provider on the pod.
 *
 * Returns `applied` only when the pod actually wrote the row. A governed write
 * comes back `proposed` — the caller MUST surface the review link rather than
 * reporting success.
 */
export async function upsertPodProvider(
  podUrl: string,
  apiKey: string,
  body: PodProviderUpsert
): Promise<PodProviderResult> {
  const res = await fetch(hubUrl(podUrl, "ai-providers"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok && res.status !== 202) await raise(res, body.providerId, hubUrl(podUrl, "ai-providers"));

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  // 202 is the governed path. Trust the STATUS FIELD rather than the code
  // alone, so a pod that starts returning 200 with `{status:"proposed"}` still
  // reads correctly here.
  if (res.status === 202 || json.status === "proposed") {
    return {
      status: "proposed",
      providerId: body.providerId,
      proposalId: String(json.proposalId ?? ""),
      message: String(
        json.message ??
          "Provider change filed for approval — it takes effect once approved."
      ),
    };
  }

  return { status: "applied", providerId: body.providerId };
}

/** Enable/disable an existing provider. Governed exactly like an upsert. */
export async function setPodProviderEnabled(
  podUrl: string,
  apiKey: string,
  providerId: string,
  enabled: boolean
): Promise<PodProviderResult> {
  const res = await fetch(
    hubUrl(podUrl, `ai-providers/${providerId}/${enabled ? "enable" : "disable"}`),
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    }
  );
  if (!res.ok && res.status !== 202) await raise(res, providerId, hubUrl(podUrl, `ai-providers/${providerId}/${enabled ? "enable" : "disable"}`));

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 202 || json.status === "proposed") {
    return {
      status: "proposed",
      providerId,
      proposalId: String(json.proposalId ?? ""),
      message: String(json.message ?? "Filed for approval."),
    };
  }
  return { status: "applied", providerId };
}

/**
 * One line to print for a result. Shared so the two commands cannot describe
 * the same outcome differently — the fork this module exists to end.
 */
export function describePodProviderResult(r: PodProviderResult): string {
  return r.status === "applied"
    ? `✓ Provider "${r.providerId}" saved on the pod and synced to the Intelligence Service.`
    : `⏳ ${r.message}\n  Provider "${r.providerId}" is NOT active yet — approve proposal ${r.proposalId} to apply it.`;
}
