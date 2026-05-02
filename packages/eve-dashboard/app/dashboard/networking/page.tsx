"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Spinner, Chip, Button, addToast,
} from "@heroui/react";
import {
  RefreshCw, Globe, Lock, ExternalLink, Copy, Check,
  ChevronDown, ChevronRight,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types — match /api/networking + /api/access
// ---------------------------------------------------------------------------

interface NetworkingData {
  domain: {
    primary?: string;
    ssl?: boolean;
    email?: string;
  } | null;
  traefik: {
    dynamicConfigPath: string;
    dynamicConfig: string | null;
    staticConfigPath: string;
    staticConfig: string | null;
    containerRunning: boolean;
  };
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

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function NetworkingPage() {
  const router = useRouter();
  const [networking, setNetworking] = useState<NetworkingData | null>(null);
  const [access, setAccess] = useState<AccessData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const [netRes, accessRes] = await Promise.all([
        fetch("/api/networking", { credentials: "include" }),
        fetch("/api/access",     { credentials: "include" }),
      ]);
      if ([netRes, accessRes].some(r => r.status === 401)) {
        router.push("/login"); return;
      }
      if (netRes.ok)    setNetworking(await netRes.json() as NetworkingData);
      if (accessRes.ok) setAccess(await accessRes.json() as AccessData);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [router]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  if (loading || !networking) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 min-h-[60vh] text-default-500">
        <Spinner size="lg" color="primary" />
        <p className="text-sm">Reading routes…</p>
      </div>
    );
  }

  const { domain, traefik } = networking;

  return (
    <div className="space-y-10">
      {/* -----------------------------------------------------------------
       * Header
       * -------------------------------------------------------------- */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-default-500">Routing</p>
          <h1 className="mt-1 font-heading text-3xl font-medium tracking-tightest text-foreground">
            Networking
          </h1>
          <p className="mt-1 max-w-2xl text-default-500">
            Domain, SSL, and the routes that connect the world to your services.
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
       * Domain & SSL
       * -------------------------------------------------------------- */}
      <Section title="Domain & SSL" description="Where your stack lives on the internet.">
        <Surface className="p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Stat
              icon={<Globe className="h-4 w-4" />}
              label="Primary domain"
              value={
                domain?.primary
                  ? <span className="font-mono text-sm text-foreground">{domain.primary}</span>
                  : <span className="text-sm text-default-400">Not set</span>
              }
            />
            <Stat
              icon={<Lock className="h-4 w-4" />}
              label="SSL"
              value={
                domain?.ssl
                  ? <Chip size="sm" color="success" variant="flat" radius="sm">enabled</Chip>
                  : <Chip size="sm" variant="flat" radius="sm">disabled</Chip>
              }
            />
            <Stat
              label="Let's Encrypt email"
              value={
                domain?.email
                  ? <span className="font-mono text-xs text-default-700">{domain.email}</span>
                  : <span className="text-xs text-default-400">Not set</span>
              }
            />
          </div>

          <div className="mt-5 border-t border-divider pt-4">
            {!domain?.primary ? (
              <CliCallout
                title="Set up a domain"
                description="Run on the host to point a domain at this server and provision a Let's Encrypt cert:"
                command="eve domain set yourdomain.com --ssl --email you@example.com"
              />
            ) : (
              <CliCallout
                title="Reconfigure"
                description="To change the domain or SSL email, run on the host:"
                command={`eve domain set ${domain.primary}${domain.ssl ? " --ssl" : ""}${domain.email ? ` --email ${domain.email}` : ""}`}
              />
            )}
          </div>
        </Surface>
      </Section>

      {/* -----------------------------------------------------------------
       * Subdomain map — every routable service
       * -------------------------------------------------------------- */}
      <Section
        title="Subdomain map"
        description="Each subdomain points to one container. DNS + container reachability are checked live."
        action={
          <Chip
            size="sm"
            variant="flat"
            color={traefik.containerRunning ? "success" : "warning"}
            radius="sm"
          >
            Traefik {traefik.containerRunning ? "running" : "down"}
          </Chip>
        }
      >
        <Surface className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-divider bg-content1">
                {["Service", "Subdomain", "Local", "Server IP", "Domain"].map(h => (
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
                  <td className="px-4 py-3 align-middle">
                    <span className="font-mono text-xs text-default-500">
                      {svc.id}
                    </span>
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
              {(access?.urls ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-default-500">
                    No routable services yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Surface>
      </Section>

      {/* -----------------------------------------------------------------
       * Traefik dynamic config — collapsible read-only view
       * -------------------------------------------------------------- */}
      <Section
        title="Traefik routes"
        description="The exact YAML Eve writes for Traefik to load. Read-only."
      >
        <CodeBlock
          title="dynamic/eve-routes.yml"
          path={traefik.dynamicConfigPath}
          content={traefik.dynamicConfig}
        />
        <CodeBlock
          title="traefik.yml (static)"
          path={traefik.staticConfigPath}
          content={traefik.staticConfig}
          startCollapsed
        />
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
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

function Stat({
  icon, label, value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-default-400">
        {icon && <span className="text-default-400">{icon}</span>}
        <span>{label}</span>
      </div>
      <div className="mt-1.5">{value}</div>
    </div>
  );
}

function UrlCell({ url, pending }: { url: string | null; pending?: boolean }) {
  if (!url) return <span className="text-default-300 text-xs">—</span>;
  const linkClass = pending ? "text-default-400 line-through" : "text-foreground hover:text-primary";
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
      {pending && (
        <Chip
          size="sm"
          color="warning"
          variant="flat"
          radius="sm"
          classNames={{ content: "px-1 text-[10px] font-medium uppercase tracking-wider" }}
          title="DNS A record is missing or pointing elsewhere"
        >
          DNS
        </Chip>
      )}
    </span>
  );
}

function CliCallout({
  title, description, command,
}: { title: string; description: string; command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-start gap-3">
      <div className="flex-1 min-w-[260px]">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-0.5 text-xs text-default-500">{description}</p>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-content2 px-3 py-2 font-mono text-xs text-foreground">
          <code>{command}</code>
        </pre>
      </div>
      <Button
        size="sm"
        variant="bordered"
        radius="md"
        startContent={
          copied
            ? <Check className="h-3.5 w-3.5 text-primary" />
            : <Copy className="h-3.5 w-3.5" />
        }
        onPress={() => {
          void navigator.clipboard.writeText(command).then(() => {
            setCopied(true);
            addToast({ title: "Command copied", color: "success" });
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

function CodeBlock({
  title, path, content, startCollapsed,
}: {
  title: string;
  path: string;
  content: string | null;
  startCollapsed?: boolean;
}) {
  const [open, setOpen] = useState(!startCollapsed);
  return (
    <div className="rounded-xl border border-divider bg-content1 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-content2/40"
      >
        {open
          ? <ChevronDown className="h-4 w-4 text-default-400" />
          : <ChevronRight className="h-4 w-4 text-default-400" />}
        <span className="text-sm font-medium text-foreground">{title}</span>
        <span className="ml-2 truncate font-mono text-xs text-default-400">{path}</span>
      </button>
      {open && (
        <div className="border-t border-divider bg-content2/30">
          {content ? (
            <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-foreground">
              <code>{content}</code>
            </pre>
          ) : (
            <p className="px-4 py-4 text-xs text-default-500">
              File not present. Either Traefik isn&apos;t installed, or{" "}
              <code className="rounded bg-content2 px-1.5 py-0.5 font-mono text-[11px] text-foreground">/opt</code>{" "}
              isn&apos;t mounted into this container.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
