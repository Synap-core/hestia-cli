"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Spinner, Chip, Button, addToast } from "@heroui/react";
import {
  RefreshCw,
  ArrowRight,
  ExternalLink,
  Github,
  Globe,
  Cpu,
  Workflow,
} from "lucide-react";

interface AppEntity {
  id: string;
  name: string;
  properties: Record<string, unknown>;
  channelId?: string | null;
  createdAt: string;
  updatedAt: string;
}

type AppStatus = "planning" | "active" | "deprecated" | "archived";

const DEVPLANE_URL = process.env.NEXT_PUBLIC_DEVPLANE_URL;

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function statusOf(v: unknown): AppStatus {
  if (v === "active" || v === "deprecated" || v === "archived") return v;
  return "planning";
}

function truncateUrl(url: string, max = 36): string {
  if (url.length <= max) return url;
  return url.replace(/^https?:\/\//, "").slice(0, max - 1) + "…";
}

export default function AppsPage() {
  const router = useRouter();
  const [apps, setApps] = useState<AppEntity[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchApps = useCallback(
    async (silent = false) => {
      if (!silent) setRefreshing(true);
      try {
        const res = await fetch("/api/apps", { credentials: "include" });
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setLoadError(body.error ?? `API responded with ${res.status}`);
          // Don't wipe stale data on a refresh blip; only on first load.
          if (!apps) setApps([]);
          return;
        }
        const data = (await res.json()) as { apps: AppEntity[] };
        setLoadError(null);
        setApps(data.apps);
      } catch (err) {
        setLoadError(
          `Could not reach API — ${err instanceof Error ? err.message : "Network error"}`,
        );
        if (!silent) addToast({ title: "Failed to load apps", color: "danger" });
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [router, apps],
  );

  useEffect(() => {
    void fetchApps();
    const interval = setInterval(() => void fetchApps(true), 30_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 min-h-[60vh] text-default-500">
        <Spinner size="lg" color="primary" />
        <p className="text-sm">Loading apps…</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-default-500">Apps</p>
          <h1 className="mt-1 font-heading text-3xl font-medium tracking-tightest text-foreground">
            Apps
          </h1>
          <p className="mt-1 text-default-500">
            Apps you&apos;re building in the Builder workspace.
          </p>
        </div>
        <Button
          variant="bordered"
          size="sm"
          radius="md"
          isLoading={refreshing}
          startContent={!refreshing ? <RefreshCw className="h-3.5 w-3.5" /> : undefined}
          onPress={() => void fetchApps()}
        >
          Refresh
        </Button>
      </header>

      {loadError && (
        <div className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm">
          <p className="font-medium text-foreground">Couldn&apos;t load some data</p>
          <p className="mt-0.5 text-default-500">{loadError}</p>
        </div>
      )}

      {apps && apps.length === 0 && !loadError ? (
        <section className="rounded-xl border border-divider bg-content1 p-8 text-center">
          <p className="text-sm text-foreground">No apps yet.</p>
          <p className="mt-1 text-xs text-default-500">
            Use{" "}
            <code className="rounded bg-content2 px-1.5 py-0.5 font-mono text-[11px]">
              eve
            </code>{" "}
            or DevPlane to create one.
          </p>
        </section>
      ) : (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {(apps ?? []).map((app) => (
            <AppCard key={app.id} app={app} />
          ))}
        </section>
      )}
    </div>
  );
}

function AppCard({ app }: { app: AppEntity }) {
  const props = app.properties;
  const appName = str(props.appName) ?? app.name ?? "Untitled app";
  const description = str(props.description);
  const techStack = str(props.techStack);
  const repoUrl = str(props.repoUrl);
  const deployUrl = str(props.deployUrl);
  const port = num(props.port);
  const status = statusOf(props.appStatus);

  const recipeSeed = encodeURIComponent(
    JSON.stringify({
      kind: "app",
      appId: app.id,
      appName,
      repoUrl,
    }),
  );

  return (
    <article className="flex flex-col gap-3 rounded-xl border border-divider bg-content1 p-4 transition-colors hover:border-primary/40">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate font-medium text-foreground">{appName}</h2>
            <StatusChip status={status} />
          </div>
          {techStack && (
            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-default-500">
              <Cpu className="h-3 w-3" />
              <span className="truncate">{techStack}</span>
            </p>
          )}
        </div>
      </header>

      {description ? (
        <p className="text-xs leading-relaxed text-default-600 line-clamp-2">
          {description}
        </p>
      ) : (
        <p className="text-xs italic text-default-400">No description.</p>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-default-500">
        {port !== null && (
          <span className="inline-flex items-center gap-1">
            <span className="text-default-400">port</span>
            <span className="font-mono text-default-700">{port}</span>
          </span>
        )}
        {repoUrl && (
          <a
            href={repoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-default-600 hover:text-primary"
            title={repoUrl}
          >
            <Github className="h-3 w-3" />
            <span className="font-mono">{truncateUrl(repoUrl, 28)}</span>
          </a>
        )}
        {deployUrl && (
          <a
            href={deployUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-default-600 hover:text-primary"
            title={deployUrl}
          >
            <Globe className="h-3 w-3" />
            <span className="font-mono">{truncateUrl(deployUrl, 28)}</span>
          </a>
        )}
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-2 border-t border-divider">
        {DEVPLANE_URL && (
          <a
            href={DEVPLANE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-lg border border-divider bg-content1 px-2.5 py-1 text-xs text-default-700 transition-colors hover:border-primary/50 hover:text-primary"
          >
            Open in DevPlane
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
        <Link
          href={`/settings/agents/coder/terminal?seed=${recipeSeed}`}
          className="inline-flex items-center gap-1 rounded-lg border border-divider bg-content1 px-2.5 py-1 text-xs text-default-700 transition-colors hover:border-primary/50 hover:text-primary"
        >
          <Workflow className="h-3 w-3" />
          Run recipe
          <ArrowRight className="h-3 w-3" />
        </Link>
        {deployUrl && (
          <a
            href={deployUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-lg border border-divider bg-content1 px-2.5 py-1 text-xs text-default-700 transition-colors hover:border-primary/50 hover:text-primary"
          >
            Visit deploy
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </article>
  );
}

function StatusChip({ status }: { status: AppStatus }) {
  if (status === "active") {
    return (
      <Chip size="sm" color="success" variant="flat">
        active
      </Chip>
    );
  }
  if (status === "deprecated") {
    return (
      <Chip size="sm" color="danger" variant="flat">
        deprecated
      </Chip>
    );
  }
  if (status === "archived") {
    return (
      <Chip size="sm" color="default" variant="dot">
        archived
      </Chip>
    );
  }
  return (
    <Chip size="sm" color="default" variant="flat">
      planning
    </Chip>
  );
}
