"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Spinner, Chip, Button, Input, Switch, addToast,
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
} from "@heroui/react";
import {
  RefreshCw, Globe, Lock, ExternalLink,
  ChevronDown, ChevronRight, Pencil, Trash2,
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
            <DomainEditor
              current={domain}
              onChanged={() => void fetchData()}
            />
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

/**
 * Inline editor for the domain block. Opens a modal with a small form
 * (primary / ssl / email) and POSTs to /api/networking/domain — the same
 * code path `eve domain set` runs on the host.
 */
function DomainEditor({
  current, onChanged,
}: {
  current: { primary?: string; ssl?: boolean; email?: string } | null;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmUnset, setConfirmUnset] = useState(false);
  const [primary, setPrimary] = useState(current?.primary ?? "");
  const [ssl, setSsl] = useState(Boolean(current?.ssl));
  const [email, setEmail] = useState(current?.email ?? "");
  const [saving, setSaving] = useState(false);
  const [unsetting, setUnsetting] = useState(false);

  // Reset form fields when the modal opens or current changes.
  useEffect(() => {
    if (open) {
      setPrimary(current?.primary ?? "");
      setSsl(Boolean(current?.ssl));
      setEmail(current?.email ?? "");
    }
  }, [open, current]);

  const onSave = useCallback(async () => {
    if (!primary.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/networking/domain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          primary: primary.trim(),
          ssl,
          email: email.trim() || undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json() as { warning?: string };
        addToast({
          title: data.warning ? "Domain saved with caveats" : "Domain configured",
          description: data.warning,
          color: data.warning ? "warning" : "success",
        });
        setOpen(false);
        onChanged();
      } else {
        const err = await res.json().catch(() => ({})) as { error?: string };
        addToast({ title: err.error ?? "Couldn't save domain", color: "danger" });
      }
    } finally { setSaving(false); }
  }, [primary, ssl, email, onChanged]);

  const onUnset = useCallback(async () => {
    setUnsetting(true);
    try {
      const res = await fetch("/api/networking/domain", {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        addToast({ title: "Domain reset to localhost", color: "success" });
        setConfirmUnset(false);
        onChanged();
      }
    } finally { setUnsetting(false); }
  }, [onChanged]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {!current?.primary ? (
          <>
            <p className="flex-1 text-sm text-default-500 min-w-[200px]">
              No domain configured. Set one to expose your services on the public internet.
            </p>
            <Button
              size="sm"
              color="primary"
              radius="md"
              startContent={<Globe className="h-3.5 w-3.5" />}
              onPress={() => setOpen(true)}
            >
              Set up domain
            </Button>
          </>
        ) : (
          <>
            <p className="flex-1 text-sm text-default-500 min-w-[200px]">
              Editing the domain re-renders Traefik routing. Brief routing downtime is expected.
            </p>
            <Button
              size="sm"
              variant="bordered"
              radius="md"
              startContent={<Pencil className="h-3.5 w-3.5" />}
              onPress={() => setOpen(true)}
            >
              Edit domain
            </Button>
            <Button
              size="sm"
              variant="bordered"
              color="danger"
              radius="md"
              startContent={<Trash2 className="h-3.5 w-3.5" />}
              onPress={() => setConfirmUnset(true)}
            >
              Reset
            </Button>
          </>
        )}
      </div>

      {/* Edit modal */}
      <Modal isOpen={open} onClose={() => setOpen(false)} size="md">
        <ModalContent>
          {() => (
            <>
              <ModalHeader>
                {current?.primary ? "Edit domain" : "Set up domain"}
              </ModalHeader>
              <ModalBody className="space-y-3">
                <Input
                  size="sm"
                  variant="bordered"
                  label="Primary domain"
                  labelPlacement="outside"
                  placeholder="example.com"
                  value={primary}
                  onValueChange={setPrimary}
                  description="Eve generates pod.<domain>, openclaw.<domain>, etc. — point those A records to this server."
                />
                <div className="flex items-center gap-3">
                  <Switch
                    size="sm"
                    isSelected={ssl}
                    onValueChange={setSsl}
                  />
                  <div className="text-sm">
                    <span className="text-foreground">Provision SSL via Let&apos;s Encrypt</span>
                    <span className="block text-xs text-default-500">
                      Requires the email below + an A record already resolving to this server.
                    </span>
                  </div>
                </div>
                {ssl && (
                  <Input
                    size="sm"
                    variant="bordered"
                    type="email"
                    label="Let's Encrypt email"
                    labelPlacement="outside"
                    placeholder="you@example.com"
                    value={email}
                    onValueChange={setEmail}
                  />
                )}
              </ModalBody>
              <ModalFooter>
                <Button size="sm" variant="light" onPress={() => setOpen(false)}>Cancel</Button>
                <Button
                  size="sm"
                  color="primary"
                  isLoading={saving}
                  isDisabled={!primary.trim() || (ssl && !email.trim())}
                  onPress={() => void onSave()}
                  startContent={!saving ? <Lock className="h-3.5 w-3.5" /> : undefined}
                >
                  Save
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Reset confirm */}
      <Modal isOpen={confirmUnset} onClose={() => setConfirmUnset(false)} size="sm">
        <ModalContent>
          {() => (
            <>
              <ModalHeader>Reset domain?</ModalHeader>
              <ModalBody>
                <p className="text-sm text-default-600">
                  This reverts Traefik to <code className="font-mono">localhost</code> routing only — your domain stops resolving to this stack until you set a new one.
                </p>
              </ModalBody>
              <ModalFooter>
                <Button size="sm" variant="light" onPress={() => setConfirmUnset(false)}>Cancel</Button>
                <Button
                  size="sm"
                  color="danger"
                  isLoading={unsetting}
                  onPress={() => void onUnset()}
                >
                  Reset
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </>
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
