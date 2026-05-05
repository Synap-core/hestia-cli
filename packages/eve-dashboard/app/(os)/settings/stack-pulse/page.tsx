"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Spinner, Chip, addToast } from "@heroui/react";
import {
  RefreshCw, RotateCcw, ArrowRight, ExternalLink, Check,
  Brain, Wrench, Hammer, Eye, Footprints,
  Boxes, ListChecks, Activity,
  type LucideIcon,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OrganState = "missing" | "installing" | "starting" | "ready" | "error" | "stopped";

interface OrganStatus {
  state: OrganState;
  installedAt?: string;
  version?: string;
  lastChecked?: string;
  errorMessage?: string;
}

interface EntityState {
  version: string;
  initializedAt: string;
  aiModel: string;
  organs: Record<string, OrganStatus>;
  installed?: Record<string, { organ?: string; state: string; version?: string }>;
  metadata?: { hostname?: string; platform?: string };
}

interface SecretsSummary {
  ai: {
    mode?: string;
    defaultProvider?: string;
    providers: Array<{ id: string; configured: boolean; hasKey: boolean }>;
  };
  synap: { configured: boolean; hasApiKey: boolean; apiUrl?: string };
  arms: { openclaw: { configured: boolean }; messaging: { configured: boolean } };
}

interface AccessData {
  urls: Array<{
    id: string;
    label: string;
    emoji: string;
    localUrl: string | null;
    serverUrl: string | null;
    domainUrl: string | null;
    port: number;
    requires: string | null;
    dnsReady: boolean | null;
  }>;
  domain: { primary?: string; ssl?: boolean } | null;
  serverIp?: string | null;
}

interface BuilderSummary {
  seeded: boolean;
  workspaceId?: string;
  counts: { apps: number; tasks: number; intents: number } | null;
  error?: string;
}

interface ComponentRow {
  id: string;
  label: string;
  emoji: string;
  description: string;
  category: string;
  organ: string | null;
  installed: boolean;
  containerRunning: boolean | null;
  hostPort: number | null;
  subdomain: string | null;
  domainUrl: string | null;
  state: string | null;
  version: string | null;
  alwaysInstall: boolean;
}

// ---------------------------------------------------------------------------
// Visual primitives
// ---------------------------------------------------------------------------

function Section({
  title, description, action, children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="font-heading text-xl font-medium tracking-tightest text-foreground">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-sm text-default-500">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Surface({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-xl border border-divider bg-content1 ${className}`}>{children}</div>
  );
}

const STATE_DOT: Record<OrganState, string> = {
  ready:      "bg-primary",
  installing: "bg-warning animate-pulse",
  starting:   "bg-warning animate-pulse",
  error:      "bg-danger",
  stopped:    "bg-default-400",
  missing:    "bg-default-300",
};

interface OrganMeta {
  id: "brain" | "arms" | "builder" | "eyes" | "legs";
  label: string;
  Icon: LucideIcon;
}

const ORGANS: OrganMeta[] = [
  { id: "brain",   label: "Brain",   Icon: Brain },
  { id: "arms",    label: "Arms",    Icon: Wrench },
  { id: "builder", label: "Builder", Icon: Hammer },
  { id: "eyes",    label: "Eyes",    Icon: Eye },
  { id: "legs",    label: "Legs",    Icon: Footprints },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const router = useRouter();
  const [state, setState] = useState<EntityState | null>(null);
  const [secrets, setSecrets] = useState<SecretsSummary | null>(null);
  const [access, setAccess] = useState<AccessData | null>(null);
  const [components, setComponents] = useState<ComponentRow[] | null>(null);
  const [builder, setBuilder] = useState<BuilderSummary | null>(null);
  const [builderStale, setBuilderStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [restarting, setRestarting] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const [stateRes, secretsRes, accessRes, componentsRes] = await Promise.all([
        fetch("/api/state",            { credentials: "include" }),
        fetch("/api/secrets-summary",  { credentials: "include" }),
        fetch("/api/access",           { credentials: "include" }),
        fetch("/api/components",       { credentials: "include" }),
      ]);

      if ([stateRes, secretsRes, accessRes, componentsRes].some(r => r.status === 401)) {
        router.push("/login");
        return;
      }

      const failed = [stateRes, secretsRes, accessRes, componentsRes].filter(r => !r.ok);
      if (failed.length > 0) {
        setLoadError(`API responded with status ${failed.map(r => r.status).join(", ")}.`);
      } else {
        setLoadError(null);
      }

      if (stateRes.ok)      setState(await stateRes.json() as EntityState);
      if (secretsRes.ok)    setSecrets(await secretsRes.json() as SecretsSummary);
      if (accessRes.ok)     setAccess(await accessRes.json() as AccessData);
      if (componentsRes.ok) {
        const data = await componentsRes.json() as { components: ComponentRow[] };
        setComponents(data.components);
      }
    } catch (err) {
      setLoadError(`Could not reach the dashboard API — ${err instanceof Error ? err.message : "Network error"}`);
      if (!silent) addToast({ title: "Failed to load state", color: "danger" });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [router]);

  useEffect(() => {
    void fetchData();
    const interval = setInterval(() => void fetchData(true), 15_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Builder summary lives on its own pipe — failure here must not affect
  // any other section of the page. Refresh on mount + every 60s.
  const fetchBuilder = useCallback(async () => {
    try {
      const res = await fetch("/api/builder/summary", { credentials: "include" });
      if (res.status === 401) { router.push("/login"); return; }
      if (res.ok) {
        const data = await res.json() as BuilderSummary;
        setBuilder(data);
        setBuilderStale(false);
      } else {
        setBuilderStale(true);
      }
    } catch {
      setBuilderStale(true);
    }
  }, [router]);

  useEffect(() => {
    void fetchBuilder();
    const interval = setInterval(() => void fetchBuilder(), 60_000);
    return () => clearInterval(interval);
  }, [fetchBuilder]);

  async function restartOrgan(organ: string) {
    setRestarting(organ);
    try {
      const res = await fetch(`/api/actions/${organ}/restart`, {
        method: "POST", credentials: "include",
      });
      if (res.status === 401) { router.push("/login"); return; }
      if (res.ok) {
        addToast({ title: `${organ} restart triggered`, color: "success" });
        setTimeout(() => void fetchData(true), 2000);
      } else {
        const d = await res.json() as { error?: string };
        addToast({ title: d.error ?? "Restart failed", color: "danger" });
      }
    } catch {
      addToast({ title: "Restart request failed", color: "danger" });
    } finally { setRestarting(null); }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 min-h-[60vh] text-default-500">
        <Spinner size="lg" color="primary" />
        <p className="text-sm">Loading your stack…</p>
      </div>
    );
  }

  const organs = state?.organs ?? {};
  const readyCount = Object.values(organs).filter(o => o.state === "ready").length;
  const launchable = (components ?? [])
    .filter(c => c.installed && c.containerRunning && (c.domainUrl || c.hostPort))
    .filter(c => c.id !== "eve-dashboard"); // hide self
  const checklist = buildChecklist({ access, secrets, components });

  return (
    <div className="space-y-10">
      {/* -----------------------------------------------------------------
       * Page header — overview heading, refresh
       * -------------------------------------------------------------- */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-default-500">Overview</p>
          <h1 className="mt-1 font-heading text-3xl font-medium tracking-tightest text-foreground">
            Your stack at a glance
          </h1>
          <p className="mt-1 text-default-500">
            <span className="text-foreground font-medium">{readyCount}</span>
            <span className="text-default-400"> / {ORGANS.length} organs ready</span>
            {state?.metadata?.hostname && (
              <>
                {" · "}
                <span className="font-mono text-xs text-default-500">{state.metadata.hostname}</span>
              </>
            )}
          </p>
        </div>
        <Button
          variant="bordered"
          size="sm"
          radius="md"
          isLoading={refreshing}
          startContent={!refreshing ? <RefreshCw className="h-3.5 w-3.5" /> : undefined}
          onPress={() => void fetchData()}
        >
          Refresh
        </Button>
      </header>

      {/* -----------------------------------------------------------------
       * Diagnostics
       * -------------------------------------------------------------- */}
      {loadError && (
        <div className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm">
          <p className="font-medium text-foreground">Couldn&apos;t load some data</p>
          <p className="mt-0.5 text-default-500">{loadError}</p>
        </div>
      )}

      {/* -----------------------------------------------------------------
       * Setup checklist — renders only while something is missing
       * -------------------------------------------------------------- */}
      {checklist.length > 0 && (
        <Section
          title="Set up"
          description="A few quick actions to get the rest of your stack live."
        >
          <Surface className="overflow-hidden">
            {checklist.map((item, i) => (
              <div
                key={item.id}
                className={
                  "flex items-start gap-3 px-4 py-3.5 " +
                  (i > 0 ? "border-t border-divider" : "")
                }
              >
                <span
                  className={
                    "mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full " +
                    (item.severity === "must"
                      ? "bg-warning/15 text-warning"
                      : "bg-default-200 text-default-500")
                  }
                  aria-hidden
                >
                  <span className="text-[11px] font-medium">{i + 1}</span>
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{item.label}</p>
                  <p className="mt-0.5 text-xs text-default-500">{item.description}</p>
                </div>
                {item.cta && (
                  <Link
                    href={item.cta.href}
                    className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-divider bg-content1 px-2.5 py-1.5 text-xs text-default-700 hover:border-primary/50 hover:text-primary transition-colors"
                  >
                    {item.cta.label}
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                )}
              </div>
            ))}
          </Surface>
        </Section>
      )}

      {/* -----------------------------------------------------------------
       * Stack pulse — compact one-row organ + count
       * -------------------------------------------------------------- */}
      <Section
        title="Stack pulse"
        description="Each organ wires together a layer of your sovereign entity."
        action={
          <Link
            href="/settings/components"
            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            View components <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        }
      >
        <Surface className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            {ORGANS.map(({ id, label, Icon }) => {
              const organ = organs[id];
              const organState = (organ?.state ?? "missing") as OrganState;
              const dim = organState === "missing";
              return (
                <button
                  key={id}
                  type="button"
                  className={
                    "group inline-flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors " +
                    (dim
                      ? "border-divider bg-content1 opacity-60 hover:opacity-100"
                      : "border-divider bg-content1 hover:border-primary/40")
                  }
                  onClick={() => organState !== "missing" && void restartOrgan(id)}
                  disabled={restarting !== null || organState === "missing"}
                  title={
                    organState === "missing"
                      ? `${label} not installed`
                      : `Click to restart ${label}`
                  }
                >
                  <Icon className="h-3.5 w-3.5 text-default-500" />
                  <span className="text-sm text-foreground">{label}</span>
                  <span className={`h-1.5 w-1.5 rounded-full ${STATE_DOT[organState]}`} aria-hidden />
                  <span className="text-[11px] text-default-400 capitalize">{organState}</span>
                  {restarting === id ? (
                    <Spinner size="sm" color="default" />
                  ) : organState !== "missing" ? (
                    <RotateCcw className="h-3 w-3 text-default-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                  ) : null}
                </button>
              );
            })}
          </div>
        </Surface>
      </Section>

      {/* -----------------------------------------------------------------
       * Builder workspace — seeded dev workspace probe
       * -------------------------------------------------------------- */}
      <Section
        title="Builder workspace"
        description="The canonical dev workspace Eve seeds on install — your apps, tasks, and active intents."
      >
        <BuilderCard
          summary={builder}
          stale={builderStale}
          devplaneUrl={process.env.NEXT_PUBLIC_DEVPLANE_URL ?? null}
        />
      </Section>

      {/* -----------------------------------------------------------------
       * Service launcher — every running service the user can open
       * -------------------------------------------------------------- */}
      <Section
        title="Open"
        description="Jump into the apps your stack is running."
        action={
          access?.domain?.primary ? (
            <Chip
              size="sm"
              variant="bordered"
              color="success"
              classNames={{ content: "font-mono text-xs" }}
            >
              {access.domain.ssl ? "https" : "http"}://{access.domain.primary}
            </Chip>
          ) : null
        }
      >
        {launchable.length === 0 ? (
          <Surface className="p-6">
            <p className="text-sm text-default-500">
              No services are running yet — install components from the{" "}
              <Link href="/settings/components" className="text-primary hover:underline">
                catalog
              </Link>{" "}
              to populate this section.
            </p>
          </Surface>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {launchable.map(c => (
              <LaunchCard key={c.id} comp={c} />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Launch card — service tile
// ---------------------------------------------------------------------------

function LaunchCard({ comp }: { comp: ComponentRow }) {
  // Pick the best URL: domain wins (proper hostname); fall back to host port.
  const href = comp.domainUrl
    ?? (comp.hostPort ? `http://${typeof window === "undefined" ? "localhost" : window.location.hostname}:${comp.hostPort}` : null);
  if (!href) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="group flex items-center gap-3 rounded-xl border border-divider bg-content1 p-4 transition-colors hover:border-primary/40 hover:bg-content2/40"
    >
      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <span className="text-lg" aria-hidden>{comp.emoji}</span>
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground">{comp.label}</p>
        <p className="truncate font-mono text-xs text-default-400" title={href}>
          {href.replace(/^https?:\/\//, "")}
        </p>
      </div>
      <ExternalLink className="h-4 w-4 shrink-0 text-default-400 transition-transform group-hover:-translate-y-0.5 group-hover:text-primary" />
    </a>
  );
}

// ---------------------------------------------------------------------------
// Builder workspace card — surfaces seeded counts + deep links
// ---------------------------------------------------------------------------

function BuilderCard({
  summary, stale, devplaneUrl,
}: {
  summary: BuilderSummary | null;
  stale: boolean;
  devplaneUrl: string | null;
}) {
  // Loading shimmer — no data fetched yet.
  if (summary === null) {
    return (
      <Surface className="p-4">
        <div className="flex items-center gap-3 text-sm text-default-500">
          <Spinner size="sm" color="default" />
          <span>Probing builder workspace…</span>
        </div>
      </Surface>
    );
  }

  // Not seeded — direct the operator to install/update.
  if (!summary.seeded) {
    return (
      <Surface className="p-5">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-foreground">
            Builder workspace not seeded yet
          </p>
          <p className="text-xs text-default-500">
            Run{" "}
            <code className="rounded bg-default-100 px-1.5 py-0.5 font-mono text-[11px] text-foreground">
              eve install
            </code>{" "}
            or{" "}
            <code className="rounded bg-default-100 px-1.5 py-0.5 font-mono text-[11px] text-foreground">
              eve update
            </code>{" "}
            to provision it on your pod.
          </p>
        </div>
      </Surface>
    );
  }

  const counts = summary.counts;
  const c = counts ?? { apps: 0, tasks: 0, intents: 0 };
  const reachIssue = stale || summary.error || counts === null;

  return (
    <Surface className="p-5">
      {/* Header row: status + open button */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success/15 text-success"
              aria-hidden
            >
              <Check className="h-3 w-3" />
            </span>
            <p className="text-sm font-medium text-foreground">Seeded</p>
            {summary.workspaceId && (
              <span
                className="truncate font-mono text-[11px] text-default-400"
                title={summary.workspaceId}
              >
                {summary.workspaceId.slice(0, 8)}…
              </span>
            )}
          </div>
          {reachIssue && (
            <p className="mt-1 text-xs text-warning">
              Couldn&apos;t reach pod — counts may be stale
              {summary.error ? ` (${summary.error})` : ""}.
            </p>
          )}
        </div>
        {devplaneUrl && (
          <a
            href={devplaneUrl}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-divider bg-content1 px-2.5 py-1.5 text-xs text-default-700 transition-colors hover:border-primary/50 hover:text-primary"
          >
            Open
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      {/* Counts row */}
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <BuilderCountTile
          icon={Boxes}
          label="apps"
          count={c.apps}
          href="/settings/apps"
        />
        <BuilderCountTile
          icon={ListChecks}
          label="tasks"
          count={c.tasks}
          // No dedicated DevPlane task view yet — fall back to /settings/apps per spec.
          href={devplaneUrl ? `${devplaneUrl}/tasks` : "/settings/apps"}
          external={Boolean(devplaneUrl)}
        />
        <BuilderCountTile
          icon={Activity}
          label="active intents"
          count={c.intents}
          href="/settings/intents?status=active"
        />
      </div>
    </Surface>
  );
}

function BuilderCountTile({
  icon: Icon, label, count, href, external = false,
}: {
  icon: LucideIcon;
  label: string;
  count: number;
  href: string;
  external?: boolean;
}) {
  const content = (
    <>
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-heading text-lg font-medium leading-none text-foreground">
          {count}
        </p>
        <p className="mt-1 text-xs text-default-500">{label}</p>
      </div>
      {external ? (
        <ExternalLink className="h-3.5 w-3.5 shrink-0 text-default-400 transition-colors group-hover:text-primary" />
      ) : (
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-default-400 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
      )}
    </>
  );

  const className =
    "group flex items-center gap-3 rounded-lg border border-divider bg-content1 px-3 py-2.5 transition-colors hover:border-primary/40";

  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={className}>
        {content}
      </a>
    );
  }
  return (
    <Link href={href} className={className}>
      {content}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Setup checklist — derives "what's missing" from current state
// ---------------------------------------------------------------------------

interface ChecklistItem {
  id: string;
  label: string;
  description: string;
  severity: "must" | "recommended";
  cta?: { label: string; href: string };
}

function buildChecklist({
  access, secrets, components,
}: {
  access: AccessData | null;
  secrets: SecretsSummary | null;
  components: ComponentRow[] | null;
}): ChecklistItem[] {
  const out: ChecklistItem[] = [];

  // 1. Domain — recommended, gates HTTPS routing.
  if (!access?.domain?.primary) {
    out.push({
      id: "domain",
      label: "Configure a domain",
      description: "Without one, services are reachable only by IP and port.",
      severity: "recommended",
      cta: { label: "Networking", href: "/settings/networking" },
    });
  }

  // 2. AI provider — must, agents idle without it.
  const hasAi = (secrets?.ai.providers ?? []).some(p => p.hasKey || p.id === "ollama");
  const aiConsumers = ["synap", "openclaw", "openwebui"];
  const hasAiConsumer = (components ?? []).some(c => c.installed && aiConsumers.includes(c.id));
  if (hasAiConsumer && !hasAi) {
    out.push({
      id: "ai",
      label: "Add an AI provider",
      description: "OpenClaw / Open WebUI / agents are idle without one.",
      severity: "must",
      cta: { label: "AI Providers", href: "/settings/ai" },
    });
  }

  // 3. Synap not running — recommended for a useful stack.
  const synap = (components ?? []).find(c => c.id === "synap");
  if (synap && !synap.installed) {
    out.push({
      id: "synap",
      label: "Install Synap Pod",
      description: "The data store every other component reads from.",
      severity: "recommended",
      cta: { label: "Components", href: "/settings/components" },
    });
  }

  return out;
}
