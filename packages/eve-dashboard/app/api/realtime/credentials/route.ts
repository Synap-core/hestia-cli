/**
 * Realtime credentials endpoint.
 *
 * The Agents app's `useRealtimeEvents` hook calls this from the browser to
 * discover (a) which pod the dashboard is paired with and (b) the API key
 * it should hand to Socket.IO's `auth.apiKey` field. The key never leaves
 * the server-side `~/.eve/secrets.json` until this exact moment — and the
 * response is `Cache-Control: no-store` so it can't be persisted by an
 * intermediate cache.
 *
 * The pod realtime server (`synap-backend/packages/realtime/server.ts`)
 * validates the key against the `api_keys` table requiring scope
 * `realtime:observe`. This dashboard ships the same key Eve uses for all
 * Hub Protocol writes — that key has the broader hub scopes and includes
 * realtime:observe by virtue of being the local-installer master key.
 *
 * If `synap.apiKey` is missing from secrets we return 503 — the Agents
 * timeline will render an empty state with a "Pair pod" CTA.
 */

import { NextResponse } from "next/server";
import { readEveSecrets, resolveSynapUrl } from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";

export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const secrets = await readEveSecrets();
  const apiKey = secrets?.synap?.apiKey;
  const podUrl = resolveSynapUrl(secrets);

  if (!apiKey || !podUrl) {
    return NextResponse.json(
      { error: "pod_not_paired" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  // The realtime server runs on a different port than the HTTP API. We
  // send both — the client picks the realtime URL but may surface the
  // pod URL for display.
  // Default realtime port is 4001 (see synap-backend/packages/realtime/server.ts).
  // When the pod is reachable through Traefik on a real domain, the realtime
  // server is exposed at `wss://pod.<domain>` on the same port mapping.
  // Locally we fall back to deriving from the pod URL.
  let realtimeUrl: string;
  try {
    const u = new URL(podUrl);
    // If the pod URL is on a real https domain, realtime traffic uses wss://
    // on the same hostname and the platform-handler-mapped port. For the
    // managed CP setup that's the same hostname on default 443.
    if (u.protocol === "https:") {
      realtimeUrl = `wss://${u.hostname}`;
    } else {
      // Local dev — explicit port 4001.
      realtimeUrl = `ws://${u.hostname}:4001`;
    }
  } catch {
    realtimeUrl = podUrl;
  }

  return NextResponse.json(
    {
      podUrl,
      realtimeUrl,
      apiKey,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
