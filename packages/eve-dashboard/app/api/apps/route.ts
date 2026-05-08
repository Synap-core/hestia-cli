/**
 * GET /api/apps — list `app` entities living in the user's Builder workspace.
 *
 * Server-side proxy to the pod's Hub Protocol REST endpoint
 * (`/api/hub/entities?profileSlug=app&workspaceId=<builder>`). The Eve
 * dashboard never talks to the pod from the browser — it always goes
 * through these route handlers so the bearer token (`secrets.agents.eve
 * .hubApiKey`) stays server-side.
 *
 * Failure modes — surfaced as JSON `{ error }` so the client can render a
 * friendly banner:
 *   • 401 — dashboard cookie missing / invalid (same shape as `/api/agents`)
 *   • 404 — `secrets.builder.workspaceId` not seeded yet → operator must
 *           run `eve install` or `eve update`
 *   • 500 — pod URL missing, pod unreachable, or any non-2xx Hub response
 */

import { NextResponse } from "next/server";
import { readEveSecrets, readAgentKeyOrLegacy, resolvePodUrl } from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";

export interface AppEntity {
  id: string;
  name: string;
  properties: Record<string, unknown>;
  channelId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const secrets = await readEveSecrets();
  const builderWorkspaceId = secrets?.builder?.workspaceId;
  if (!builderWorkspaceId) {
    return NextResponse.json(
      {
        error:
          "Builder workspace not seeded yet. Run `eve install` or `eve update`.",
      },
      { status: 404 },
    );
  }

  const podUrl = await resolvePodUrl();
  if (!podUrl) {
    return NextResponse.json(
      { error: "Synap pod URL unresolved — set domain.primary in secrets.json." },
      { status: 500 },
    );
  }

  const eveKey = await readAgentKeyOrLegacy("eve");
  if (!eveKey) {
    return NextResponse.json(
      { error: "Eve Hub API key missing (secrets.agents.eve.hubApiKey)." },
      { status: 500 },
    );
  }

  const url = new URL(`${podUrl.replace(/\/+$/, "")}/api/hub/entities`);
  url.searchParams.set("profileSlug", "app");
  url.searchParams.set("workspaceId", builderWorkspaceId);

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${eveKey}` },
      cache: "no-store",
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: `Could not reach pod: ${
          err instanceof Error ? err.message : "network error"
        }`,
      },
      { status: 500 },
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return NextResponse.json(
      {
        error: `Pod responded ${res.status}${body ? `: ${body.slice(0, 240)}` : ""}`,
      },
      { status: 500 },
    );
  }

  // The Hub returns either { entities: [...] } or a bare array depending on
  // the route version — handle both defensively.
  const raw = (await res.json().catch(() => null)) as
    | { entities?: unknown[] }
    | unknown[]
    | null;
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.entities)
      ? raw.entities
      : [];

  const apps: AppEntity[] = list.map((row) => {
    const e = row as Record<string, unknown>;
    return {
      id: String(e.id ?? ""),
      name: String(e.name ?? ""),
      properties: (e.properties as Record<string, unknown>) ?? {},
      channelId:
        typeof e.channelId === "string"
          ? e.channelId
          : typeof e.channel_id === "string"
            ? (e.channel_id as string)
            : null,
      createdAt: String(e.createdAt ?? e.created_at ?? ""),
      updatedAt: String(e.updatedAt ?? e.updated_at ?? ""),
    };
  });

  return NextResponse.json({ apps });
}
