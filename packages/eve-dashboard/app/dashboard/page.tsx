"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button, Spinner, addToast } from "@heroui/react";
import {
  RefreshCw, RotateCcw, Wifi, WifiOff, Copy, ExternalLink, Check, ArrowRight,
  Brain, Wrench, Hammer, Eye, Footprints,
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

interface ServiceAccess {
  id: string;
  label: string;
  emoji: string;
  localUrl: string | null;
  serverUrl: string | null;
  domainUrl: string | null;
  port: number;
  requires: string | null;
  dnsReady: boolean | null;
}

interface AccessData {
  urls: ServiceAccess[];
  domain: { primary?: string; ssl?: boolean } | null;
  serverIp?: string | null;
}

// ---------------------------------------------------------------------------
// Visual primitives — local, theme-token-only, no shadows
// ---------------------------------------------------------------------------

function Section({
  title,
  description,
  action,
  children,
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
          {description && (
            <p className="mt-0.5 text-sm text-default-500">{description}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Surface({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
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

function StateDot({ state }: { state: OrganState }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className={`h-1.5 w-1.5 rounded-full ${STATE_DOT[state]}`} aria-hidden />
      <span className="capitalize text-default-500">{state}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Organs config — lucide icons, not emoji, for proper theme integration
// ---------------------------------------------------------------------------

interface OrganMeta {
  id: "brain" | "arms" | "builder" | "eyes" | "legs";
  label: string;
  desc: string;
  Icon: LucideIcon;
}

const ORGANS: OrganMeta[] = [
  { id: "brain",   label: "Brain",   desc: "Synap pod + data stores", Icon: Brain },
  { id: "arms",    label: "Arms",    desc: "OpenClaw / MCP actions",  Icon: Wrench },
  { id: "builder", label: "Builder", desc: "Code engine",             Icon: Hammer },
  { id: "eyes",    label: "Eyes",    desc: "RSSHub / feeds",          Icon: Eye },
  { id: "legs",    label: "Legs",    desc: "Traefik / domains",       Icon: Footprints },
];

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="inline-flex items-center justify-center text-default-400 hover:text-foreground transition-colors"
      aria-label="Copy"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function UrlCell({ url, pending }: { url: string | null; pending?: boolean }) {
  if (!url) return <span className="text-default-300 text-xs">—</span>;
  const linkClass = pending
    ? "text-default-400 line-through"
    : "text-foreground hover:text-primary";
  return (
    <span className="inline-flex items-center gap-1.5 max-w-full">
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className={`font-mono text-xs truncate transition-colors ${linkClass}`}
        title={pending ? "DNS not yet pointing to this server" : url}
      >
        {url.replace(/^https?:\/\//, "")}
      </a>
      <ExternalLink className="h-3 w-3 shrink-0 text-default-400" />
      <CopyButton value={url} />
      {pending && (
        <span
          className="rounded-full bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-warning"
          title="DNS A record is missing or pointing elsewhere"
        >
          DNS
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const router = useRouter();
  const [state, setState] = useState<EntityState | null>(null);
  const [secrets, setSecrets] = useState<SecretsSummary | null>(null);
  const [access, setAccess] = useState<AccessData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [restarting, setRestarting] = useState<string | null>(null);

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const [stateRes, secretsRes, accessRes] = await Promise.all([
        fetch("/api/state",            { credentials: "include" }),
        fetch("/api/secrets-summary",  { credentials: "include" }),
        fetch("/api/access",           { credentials: "include" }),
      ]);

      if ([stateRes, secretsRes, accessRes].some(r => r.status === 401)) {
        router.push("/login");
        return;
      }

      if (stateRes.ok)   setState(await stateRes.json() as EntityState);
      if (secretsRes.ok) setSecrets(await secretsRes.json() as SecretsSummary);
      if (accessRes.ok)  setAccess(await accessRes.json() as AccessData);
    } catch {
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

  async function restartOrgan(organ: string) {
    setRestarting(organ);
    try {
      const res = await fetch(`/api/actions/${organ}/restart`, {
        method: "POST",
        credentials: "include",
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
    } finally {
      setRestarting(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Spinner size="lg" color="primary" />
      </div>
    );
  }

  const organs = state?.organs ?? {};
  const readyCount = Object.values(organs).filter(o => o.state === "ready").length;
  const hasDomain = !!access?.domain?.primary;

  return (
    <div className="space-y-10">
      {/* -----------------------------------------------------------------
       * Page header
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
       * Organs
       * -------------------------------------------------------------- */}
      <Section title="Organs" description="The five layers that make up your sovereign entity.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {ORGANS.map(({ id, label, desc, Icon }) => {
            const organ = organs[id];
            const organState = (organ?.state ?? "missing") as OrganState;
            return (
              <Surface key={id} className="p-4 flex flex-col gap-3 transition-colors hover:bg-content2/40">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-content2 text-default-700">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="font-medium text-foreground">{label}</span>
                  <span className="ml-auto"><StateDot state={organState} /></span>
                </div>
                <p className="text-xs text-default-500">{desc}</p>
                <div className="mt-auto flex items-center gap-2 pt-1 text-[11px] text-default-400">
                  {organ?.version && (
                    <span className="font-mono">v{organ.version}</span>
                  )}
                  {organ?.lastChecked && (
                    <span>· {new Date(organ.lastChecked).toLocaleTimeString()}</span>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="light"
                  radius="md"
                  startContent={
                    restarting === id
                      ? <Spinner size="sm" color="default" />
                      : <RotateCcw className="h-3.5 w-3.5" />
                  }
                  isDisabled={restarting !== null || organState === "missing"}
                  onPress={() => void restartOrgan(id)}
                  className="justify-start text-default-600 hover:text-foreground"
                >
                  Restart
                </Button>
                {organ?.errorMessage && (
                  <p className="truncate text-xs text-danger" title={organ.errorMessage}>
                    {organ.errorMessage}
                  </p>
                )}
              </Surface>
            );
          })}
        </div>
      </Section>

      {/* -----------------------------------------------------------------
       * Access — service URL table
       * -------------------------------------------------------------- */}
      <Section
        title="Access"
        description="Every place you can reach this stack from."
        action={
          hasDomain ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-divider bg-content1 px-2.5 py-1 text-xs">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
              <span className="font-mono text-default-700">
                {access?.domain?.ssl ? "https" : "http"}://{access?.domain?.primary}
              </span>
            </span>
          ) : null
        }
      >
        {!hasDomain && (
          <div className="rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-warning-700 dark:text-warning">
            <p>
              No domain configured.{" "}
              <span className="text-foreground/80">For HTTPS access, run </span>
              <code className="rounded bg-content2 px-1.5 py-0.5 font-mono text-xs text-foreground">
                eve domain set yourdomain.com --ssl
              </code>
              .
            </p>
          </div>
        )}

        <Surface className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-divider bg-content1">
                {["Service", "Local", "Server IP", "Domain"].map(h => (
                  <th
                    key={h}
                    className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-default-400"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(access?.urls ?? []).map((svc, i) => (
                <tr
                  key={svc.id}
                  className={
                    "transition-colors hover:bg-content2/40 " +
                    (i > 0 ? "border-t border-divider" : "")
                  }
                >
                  <td className="px-4 py-3 align-middle">
                    <span className="font-medium text-foreground">{svc.label}</span>
                  </td>
                  <td className="px-4 py-3 align-middle"><UrlCell url={svc.localUrl} /></td>
                  <td className="px-4 py-3 align-middle"><UrlCell url={svc.serverUrl} /></td>
                  <td className="px-4 py-3 align-middle">
                    <UrlCell
                      url={svc.domainUrl}
                      pending={svc.domainUrl !== null && svc.dnsReady === false}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Surface>
      </Section>

      {/* -----------------------------------------------------------------
       * AI Providers — at-a-glance, link to full editor
       * -------------------------------------------------------------- */}
      <Section
        title="AI Providers"
        description="The brain behind your agents — keys live only on this server."
        action={
          <a
            href="/dashboard/ai"
            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            Configure <ArrowRight className="h-3.5 w-3.5" />
          </a>
        }
      >
        <Surface className="p-5 space-y-4">
          {!secrets ? (
            <p className="text-sm text-default-400">No provider config found.</p>
          ) : secrets.ai.providers.length === 0 ? (
            <a
              href="/dashboard/ai"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              No providers yet — add one
              <ArrowRight className="h-3.5 w-3.5" />
            </a>
          ) : (
            <>
              {secrets.ai.defaultProvider && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs uppercase tracking-wider text-default-400">Default</span>
                  <span className="rounded-md bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
                    {secrets.ai.defaultProvider}
                  </span>
                  {secrets.ai.mode && (
                    <span className="rounded-md bg-content2 px-2 py-0.5 text-xs text-default-600">
                      {secrets.ai.mode}
                    </span>
                  )}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {secrets.ai.providers.map(p => {
                  const ok = p.configured && p.hasKey;
                  return (
                    <span
                      key={p.id}
                      className="inline-flex items-center gap-2 rounded-lg border border-divider bg-content1 px-3 py-1.5 text-xs"
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-primary" : "bg-default-400"}`}
                        aria-hidden
                      />
                      <span className="font-medium text-foreground">{p.id}</span>
                      <span className="text-default-400">{ok ? "configured" : "no key"}</span>
                    </span>
                  );
                })}
              </div>
            </>
          )}
        </Surface>
      </Section>

      {/* -----------------------------------------------------------------
       * Wiring
       * -------------------------------------------------------------- */}
      <Section title="Wiring" description="Connections between organs and external services.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <WiringCard
            label="Synap Pod"
            sub={secrets?.synap.apiUrl ?? "Not configured"}
            online={secrets?.synap.configured ?? false}
            badgeOk={secrets?.synap.hasApiKey ?? false}
            okText="API key set"
            offText="No API key"
          />
          <WiringCard
            label="OpenClaw"
            sub="Arms organ bridge"
            online={secrets?.arms.openclaw.configured ?? false}
            badgeOk={secrets?.arms.openclaw.configured ?? false}
            okText="wired"
            offText="not wired"
          />
        </div>
      </Section>
    </div>
  );
}

function WiringCard({
  label, sub, online, badgeOk, okText, offText,
}: {
  label: string;
  sub: string;
  online: boolean;
  badgeOk: boolean;
  okText: string;
  offText: string;
}) {
  return (
    <Surface className="p-4 flex items-center gap-3">
      <span
        className={
          "inline-flex h-9 w-9 items-center justify-center rounded-lg " +
          (online ? "bg-primary/10 text-primary" : "bg-content2 text-default-400")
        }
      >
        {online ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="truncate font-mono text-xs text-default-400">{sub}</p>
      </div>
      <span
        className={
          "rounded-full px-2 py-0.5 text-[11px] font-medium " +
          (badgeOk ? "bg-primary/15 text-primary" : "bg-warning/15 text-warning")
        }
      >
        {badgeOk ? okText : offText}
      </span>
    </Surface>
  );
}
