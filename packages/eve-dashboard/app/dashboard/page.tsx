"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Card, CardBody, CardHeader, Chip, Button, Divider, Spinner, addToast,
} from "@heroui/react";
import { RefreshCw, RotateCcw, Wifi, WifiOff, Copy, ExternalLink } from "lucide-react";

type OrganStatus = {
  state: "missing" | "installing" | "starting" | "ready" | "error" | "stopped";
  installedAt?: string;
  version?: string;
  lastChecked?: string;
  errorMessage?: string;
};

type EntityState = {
  version: string;
  initializedAt: string;
  aiModel: string;
  organs: Record<string, OrganStatus>;
  installed?: Record<string, { organ?: string; state: string; version?: string }>;
  metadata?: { hostname?: string; platform?: string };
};

type SecretsSummary = {
  ai: {
    mode?: string;
    defaultProvider?: string;
    providers: Array<{ id: string; configured: boolean; hasKey: boolean }>;
  };
  synap: { configured: boolean; hasApiKey: boolean; apiUrl?: string };
  arms: { openclaw: { configured: boolean }; messaging: { configured: boolean } };
};

type ServiceAccess = {
  id: string;
  label: string;
  emoji: string;
  localUrl: string | null;
  serverUrl: string | null;
  domainUrl: string | null;
  port: number;
  requires: string | null;
  dnsReady: boolean | null;
};

type AccessData = {
  urls: ServiceAccess[];
  domain: { primary?: string; ssl?: boolean } | null;
  serverIp?: string | null;
};

const ORGANS = [
  { id: "brain", emoji: "🧠", label: "Brain", desc: "Synap pod + data stores" },
  { id: "arms", emoji: "🦾", label: "Arms", desc: "OpenClaw / MCP" },
  { id: "builder", emoji: "🏗️", label: "Builder", desc: "Code engine" },
  { id: "eyes", emoji: "👁️", label: "Eyes", desc: "RSSHub / feeds" },
  { id: "legs", emoji: "🦿", label: "Legs", desc: "Traefik / domains" },
] as const;

function statusColor(state: string): "success" | "danger" | "default" | "warning" | "primary" {
  switch (state) {
    case "ready": return "success";
    case "error": return "danger";
    case "stopped": return "default";
    case "missing": return "warning";
    case "installing":
    case "starting": return "primary";
    default: return "default";
  }
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="ml-1 text-default-400 hover:text-default-600 transition-colors"
      title="Copy"
    >
      <Copy className={`w-3 h-3 ${copied ? "text-success" : ""}`} />
    </button>
  );
}

function UrlCell({ url, pending }: { url: string | null; pending?: boolean }) {
  if (!url) return <span className="text-default-300 text-xs">—</span>;
  const colorClass = pending ? "text-default-400 line-through" : "text-primary hover:underline";
  return (
    <span className="flex items-center gap-1">
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className={`text-xs font-mono truncate max-w-[180px] ${colorClass}`}
        title={pending ? "DNS not yet pointing to this server" : undefined}
      >
        {url}
      </a>
      <ExternalLink className="w-3 h-3 text-default-400 shrink-0" />
      <CopyButton value={url} />
      {pending && (
        <span
          className="text-[10px] uppercase tracking-wider text-warning bg-warning-50 dark:bg-warning-900/20 px-1.5 py-0.5 rounded"
          title="DNS A record is missing or pointing elsewhere"
        >
          DNS
        </span>
      )}
    </span>
  );
}

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
        fetch("/api/state", { credentials: "include" }),
        fetch("/api/secrets-summary", { credentials: "include" }),
        fetch("/api/access", { credentials: "include" }),
      ]);

      if ([stateRes, secretsRes, accessRes].some(r => r.status === 401)) {
        router.push("/login");
        return;
      }

      if (stateRes.ok) setState(await stateRes.json() as EntityState);
      if (secretsRes.ok) setSecrets(await secretsRes.json() as SecretsSummary);
      if (accessRes.ok) setAccess(await accessRes.json() as AccessData);
    } catch {
      if (!silent) addToast({ title: "Failed to load state", color: "danger" });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [router]);

  useEffect(() => {
    void fetchData();
    // Auto-refresh every 15 seconds so organ states stay current (silent = no spinner)
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
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" color="primary" />
      </div>
    );
  }

  const organs = state?.organs ?? {};
  const readyCount = Object.values(organs).filter((o) => o.state === "ready").length;
  const hasDomain = !!access?.domain?.primary;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">System Status</h1>
          {state?.metadata?.hostname && (
            <p className="text-sm text-default-400 mt-0.5 font-mono">{state.metadata.hostname}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Chip size="sm" color={readyCount === 5 ? "success" : readyCount > 2 ? "warning" : "danger"} variant="flat">
            {readyCount}/5 organs ready
          </Chip>
          <Button
            variant="bordered"
            size="sm"
            isLoading={refreshing}
            startContent={!refreshing ? <RefreshCw className="w-3.5 h-3.5" /> : undefined}
            onPress={() => void fetchData()}
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* Organ cards */}
      <div>
        <h2 className="text-sm font-semibold text-default-500 uppercase tracking-wider mb-3">Organs</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {ORGANS.map(({ id, emoji, label, desc }) => {
            const organ = organs[id];
            const organState = organ?.state ?? "missing";
            return (
              <Card key={id} className="bg-content1 border border-divider">
                <CardHeader className="pb-1 flex justify-between items-start">
                  <div>
                    <span className="text-xl mr-1">{emoji}</span>
                    <span className="font-semibold text-foreground">{label}</span>
                  </div>
                  <Chip size="sm" color={statusColor(organState)} variant="flat">
                    {organState}
                  </Chip>
                </CardHeader>
                <CardBody className="pt-1 space-y-3">
                  <p className="text-xs text-default-400">{desc}</p>
                  {organ?.version && (
                    <p className="text-xs text-default-300 font-mono">v{organ.version}</p>
                  )}
                  {organ?.errorMessage && (
                    <p className="text-xs text-danger truncate" title={organ.errorMessage}>
                      {organ.errorMessage}
                    </p>
                  )}
                  {organ?.lastChecked && (
                    <p className="text-xs text-default-300">
                      Checked {new Date(organ.lastChecked).toLocaleTimeString()}
                    </p>
                  )}
                  <Button
                    size="sm"
                    variant="light"
                    color="default"
                    startContent={
                      restarting === id
                        ? <Spinner size="sm" color="default" />
                        : <RotateCcw className="w-3.5 h-3.5" />
                    }
                    isDisabled={restarting !== null || organState === "missing"}
                    onPress={() => void restartOrgan(id)}
                    className="w-full"
                  >
                    Restart
                  </Button>
                </CardBody>
              </Card>
            );
          })}
        </div>
      </div>

      <Divider />

      {/* Access URLs */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-default-500 uppercase tracking-wider">Access</h2>
          {hasDomain && (
            <Chip size="sm" color="success" variant="flat">
              {access?.domain?.ssl ? "https" : "http"}://{access?.domain?.primary}
            </Chip>
          )}
        </div>

        {!hasDomain && (
          <div className="mb-4 p-3 bg-warning-50 border border-warning-200 rounded-xl text-warning-700 text-sm dark:bg-warning-900/20 dark:border-warning-800 dark:text-warning-400">
            No domain configured — run{" "}
            <code className="bg-warning-100 dark:bg-warning-900/40 px-1.5 py-0.5 rounded font-mono text-xs">
              eve domain set yourdomain.com --ssl
            </code>{" "}
            to enable remote access.
          </div>
        )}

        <Card className="bg-content1 border border-divider">
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-divider">
                  <th className="text-left text-xs text-default-400 font-medium px-4 py-2.5">Service</th>
                  <th className="text-left text-xs text-default-400 font-medium px-4 py-2.5">Local</th>
                  <th className="text-left text-xs text-default-400 font-medium px-4 py-2.5">Server IP</th>
                  <th className="text-left text-xs text-default-400 font-medium px-4 py-2.5">Domain</th>
                </tr>
              </thead>
              <tbody>
                {(access?.urls ?? []).map((svc, i) => (
                  <tr key={svc.id} className={i > 0 ? "border-t border-divider" : ""}>
                    <td className="px-4 py-2.5 font-medium text-foreground whitespace-nowrap">
                      <span className="mr-1.5">{svc.emoji}</span>
                      {svc.label}
                    </td>
                    <td className="px-4 py-2.5"><UrlCell url={svc.localUrl} /></td>
                    <td className="px-4 py-2.5"><UrlCell url={svc.serverUrl} /></td>
                    <td className="px-4 py-2.5">
                      <UrlCell
                        url={svc.domainUrl}
                        pending={svc.domainUrl !== null && svc.dnsReady === false}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      </div>

      <Divider />

      {/* AI Providers */}
      <div>
        <h2 className="text-sm font-semibold text-default-500 uppercase tracking-wider mb-3">AI Providers</h2>
        <Card className="bg-content1 border border-divider">
          <CardBody>
            {!secrets ? (
              <p className="text-default-400 text-sm">No provider config found</p>
            ) : (
              <div className="space-y-3">
                {secrets.ai.defaultProvider && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-default-500 w-32">Default provider</span>
                    <Chip size="sm" color="primary" variant="flat">{secrets.ai.defaultProvider}</Chip>
                    {secrets.ai.mode && (
                      <Chip size="sm" variant="flat" color="default">{secrets.ai.mode}</Chip>
                    )}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {secrets.ai.providers.map((p) => (
                    <div key={p.id} className="flex items-center gap-1.5 bg-content2 rounded-lg px-3 py-1.5">
                      <Chip
                        size="sm"
                        color={p.configured && p.hasKey ? "success" : "default"}
                        variant="dot"
                      >
                        {p.id}
                      </Chip>
                      <span className="text-xs text-default-400">
                        {p.configured && p.hasKey ? "configured" : "not configured"}
                      </span>
                    </div>
                  ))}
                  {secrets.ai.providers.length === 0 && (
                    <p className="text-default-400 text-sm">No providers configured</p>
                  )}
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <Divider />

      {/* Wiring status */}
      <div>
        <h2 className="text-sm font-semibold text-default-500 uppercase tracking-wider mb-3">Wiring</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card className="bg-content1 border border-divider">
            <CardBody>
              <div className="flex items-center gap-3">
                {secrets?.synap.configured ? (
                  <Wifi className="w-5 h-5 text-success" />
                ) : (
                  <WifiOff className="w-5 h-5 text-default-400" />
                )}
                <div>
                  <p className="font-medium text-foreground text-sm">Synap Pod</p>
                  {secrets?.synap.apiUrl ? (
                    <p className="text-xs text-default-400 font-mono truncate max-w-[200px]">
                      {secrets.synap.apiUrl}
                    </p>
                  ) : (
                    <p className="text-xs text-default-400">Not configured</p>
                  )}
                </div>
                <div className="ml-auto">
                  <Chip
                    size="sm"
                    color={secrets?.synap.hasApiKey ? "success" : "warning"}
                    variant="flat"
                  >
                    {secrets?.synap.hasApiKey ? "API key set" : "No API key"}
                  </Chip>
                </div>
              </div>
            </CardBody>
          </Card>

          <Card className="bg-content1 border border-divider">
            <CardBody>
              <div className="flex items-center gap-3">
                {secrets?.arms.openclaw.configured ? (
                  <Wifi className="w-5 h-5 text-success" />
                ) : (
                  <WifiOff className="w-5 h-5 text-default-400" />
                )}
                <div>
                  <p className="font-medium text-foreground text-sm">OpenClaw</p>
                  <p className="text-xs text-default-400">Arms organ bridge</p>
                </div>
                <div className="ml-auto">
                  <Chip
                    size="sm"
                    color={secrets?.arms.openclaw.configured ? "success" : "warning"}
                    variant="flat"
                  >
                    {secrets?.arms.openclaw.configured ? "wired" : "not wired"}
                  </Chip>
                </div>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
