/**
 * Builder workspace summary
 *
 * Reads `secrets.builder.workspaceId` and (when present) probes the pod's
 * Hub REST surface in parallel for the three counts surfaced on the home
 * card:
 *   - apps       (entities with profileSlug=app, scoped to the builder ws)
 *   - tasks      (entities with profileSlug=task, scoped to the builder ws)
 *   - intents    (background_tasks with status=active, user-scoped on the pod)
 *
 * Failure mode: returns `seeded: true` with `counts: null` and an `error`
 * string so the dashboard renders the card gracefully — the home page must
 * never block on this endpoint.
 */
import { NextResponse } from "next/server";
import { readEveSecrets, readAgentKeyOrLegacy, resolveHubBaseUrl } from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";

interface BuilderSummary {
  seeded: boolean;
  workspaceId?: string;
  counts: {
    apps: number;
    tasks: number;
    intents: number;
  } | null;
  error?: string;
}

async function fetchCount(
  url: string,
  apiKey: string,
  pick: (json: unknown) => number,
): Promise<number> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
    // Hub probes are cheap; never cache through Next's fetch cache.
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} on ${new URL(url).pathname}`);
  }
  const json = (await res.json()) as unknown;
  return pick(json);
}

export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const secrets = await readEveSecrets();
  const workspaceId = secrets?.builder?.workspaceId;

  if (!workspaceId) {
    const body: BuilderSummary = { seeded: false, counts: null };
    return NextResponse.json(body);
  }

  const hubBase = resolveHubBaseUrl(secrets);
  const apiKey = await readAgentKeyOrLegacy("eve");

  if (!hubBase || !apiKey) {
    const body: BuilderSummary = {
      seeded: true,
      workspaceId,
      counts: null,
      error: !hubBase
        ? "Pod URL not configured"
        : "Eve agent key not minted yet",
    };
    return NextResponse.json(body);
  }

  const wsParam = encodeURIComponent(workspaceId);
  const appsUrl = `${hubBase}/entities?profileSlug=app&workspaceId=${wsParam}&limit=100`;
  const tasksUrl = `${hubBase}/entities?profileSlug=task&workspaceId=${wsParam}&limit=100`;
  const intentsUrl = `${hubBase}/background-tasks?status=active`;

  try {
    const [apps, tasks, intents] = await Promise.all([
      fetchCount(appsUrl, apiKey, (j) => (Array.isArray(j) ? j.length : 0)),
      fetchCount(tasksUrl, apiKey, (j) => (Array.isArray(j) ? j.length : 0)),
      fetchCount(intentsUrl, apiKey, (j) => {
        // background-tasks returns `{ tasks: [...] }`
        if (
          j &&
          typeof j === "object" &&
          "tasks" in j &&
          Array.isArray((j as { tasks: unknown[] }).tasks)
        ) {
          return (j as { tasks: unknown[] }).tasks.length;
        }
        return 0;
      }),
    ]);

    const body: BuilderSummary = {
      seeded: true,
      workspaceId,
      counts: { apps, tasks, intents },
    };
    return NextResponse.json(body);
  } catch (err) {
    const body: BuilderSummary = {
      seeded: true,
      workspaceId,
      counts: null,
      error: err instanceof Error ? err.message : "Unknown error",
    };
    return NextResponse.json(body);
  }
}
