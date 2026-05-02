"use client";

/**
 * Component detail drawer — slide-in from right.
 *
 * Shows everything about one component: what it is, why your stack uses it,
 * live container monitoring, real actions (restart) + copy-CLI for the
 * deferred ones (install / remove).
 */

import { useEffect, useState, useCallback } from "react";
import {
  Drawer, DrawerContent, DrawerHeader, DrawerBody, DrawerFooter,
  Spinner, Button, Chip, addToast,
} from "@heroui/react";
import {
  RefreshCw, RotateCcw, ExternalLink, Copy, Check, X, Globe,
  Activity, Boxes, Plug, FileText,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types — match /api/components/[id]
// ---------------------------------------------------------------------------

interface ComponentDetail {
  id: string;
  label: string;
  emoji: string;
  description: string;
  longDescription: string | null;
  homepage: string | null;
  category: string;
  organ: string | null;
  alwaysInstall: boolean;
  requires: Array<{ id: string; label: string }>;
  requiredBy: Array<{ id: string; label: string }>;
  installed: boolean;
  recordedState: string | null;
  recordedVersion: string | null;
  container: {
    name: string;
    internalPort: number | null;
    hostPort: number | null;
    subdomain: string | null;
    domainUrl: string | null;
    inspect: {
      id: string;
      image: string;
      status: "running" | "exited" | "restarting" | "paused" | "unknown";
      exitCode: number | null;
      startedAt: string | null;
      finishedAt: string | null;
      restartCount: number;
    } | null;
  } | null;
  logs: string | null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function ComponentDetailDrawer({
  componentId,
  isOpen,
  onClose,
  onChange,
}: {
  componentId: string | null;
  isOpen: boolean;
  onClose: () => void;
  /** Called after a successful action that may have changed list state. */
  onChange?: () => void;
}) {
  const [detail, setDetail] = useState<ComponentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [restarting, setRestarting] = useState(false);

  const fetchDetail = useCallback(async (silent = false) => {
    if (!componentId) return;
    if (!silent) setRefreshing(true);
    try {
      const res = await fetch(`/api/components/${componentId}`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json() as ComponentDetail;
        setDetail(data);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [componentId]);

  // Reset on close, fetch on open with a new id
  useEffect(() => {
    if (!isOpen || !componentId) {
      setDetail(null);
      setLoading(true);
      return;
    }
    void fetchDetail();
  }, [isOpen, componentId, fetchDetail]);

  async function restart() {
    if (!componentId) return;
    setRestarting(true);
    try {
      const res = await fetch(`/api/components/${componentId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "restart" }),
      });
      if (res.ok) {
        addToast({ title: "Restart triggered", color: "success" });
        // Give Docker a moment to show the new state, then refresh.
        setTimeout(() => {
          void fetchDetail(true);
          onChange?.();
        }, 1500);
      } else {
        const err = await res.json() as { error?: string };
        addToast({ title: err.error ?? "Restart failed", color: "danger" });
      }
    } catch {
      addToast({ title: "Restart failed", color: "danger" });
    } finally { setRestarting(false); }
  }

  return (
    <Drawer
      isOpen={isOpen}
      onOpenChange={(open) => { if (!open) onClose(); }}
      placement="right"
      size="lg"
      hideCloseButton
      classNames={{
        base: "bg-content1",
        header: "border-b border-divider",
        footer: "border-t border-divider",
      }}
    >
      <DrawerContent>
        {() => (
          <>
            <DrawerHeader className="px-6 py-4">
              {detail ? (
                <div className="flex items-start justify-between gap-3 w-full">
                  <div className="flex items-start gap-3 min-w-0">
                    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary text-xl">
                      <span aria-hidden>{detail.emoji}</span>
                    </span>
                    <div className="min-w-0">
                      <h2 className="font-heading text-xl font-medium tracking-tightest text-foreground truncate">
                        {detail.label}
                      </h2>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        <StatusChip detail={detail} />
                        {detail.recordedVersion && (
                          <span className="font-mono text-[11px] text-default-400">
                            v{detail.recordedVersion}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => void fetchDetail()}
                      disabled={refreshing}
                      aria-label="Refresh"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-default-500 hover:text-foreground hover:bg-content2 transition-colors disabled:opacity-50"
                    >
                      <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                    </button>
                    <button
                      type="button"
                      onClick={onClose}
                      aria-label="Close"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-default-500 hover:text-foreground hover:bg-content2 transition-colors"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="h-10" aria-hidden />
              )}
            </DrawerHeader>

            <DrawerBody className="px-6 py-6">
              {loading || !detail ? (
                <div className="flex flex-col items-center justify-center gap-3 py-20 text-default-500">
                  <Spinner size="lg" color="primary" />
                  <p className="text-sm">Loading component…</p>
                </div>
              ) : (
                <DetailBody detail={detail} onRestart={restart} restarting={restarting} />
              )}
            </DrawerBody>

            {detail && (
              <DrawerFooter className="px-6 py-3">
                <span className="text-xs text-default-400">
                  Eve component · {detail.category}
                </span>
              </DrawerFooter>
            )}
          </>
        )}
      </DrawerContent>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------

function DetailBody({
  detail, onRestart, restarting,
}: {
  detail: ComponentDetail;
  onRestart: () => void;
  restarting: boolean;
}) {
  const longDesc = detail.longDescription ?? detail.description;
  const paragraphs = longDesc.split(/\n\s*\n/).filter(Boolean);
  const canRestart = detail.installed && detail.container !== null;

  return (
    <div className="space-y-8">
      {/* What & why */}
      <Section title="About" icon={<FileText className="h-4 w-4" />}>
        <div className="space-y-3 text-sm leading-relaxed text-default-700">
          {paragraphs.map((p, i) => <p key={i}>{p}</p>)}
        </div>
        {detail.homepage && (
          <a
            href={detail.homepage}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            Upstream project <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </Section>

      {/* Actions */}
      <Section title="Actions" icon={<Activity className="h-4 w-4" />}>
        <div className="flex flex-wrap gap-2">
          {detail.container?.domainUrl && detail.container.inspect?.status === "running" && (
            <Button
              as="a"
              href={detail.container.domainUrl}
              target="_blank"
              rel="noreferrer"
              size="sm"
              color="primary"
              radius="md"
              startContent={<ExternalLink className="h-3.5 w-3.5" />}
            >
              Open
            </Button>
          )}
          {canRestart && (
            <Button
              size="sm"
              variant="bordered"
              radius="md"
              startContent={!restarting ? <RotateCcw className="h-3.5 w-3.5" /> : undefined}
              isLoading={restarting}
              onPress={onRestart}
            >
              {restarting ? "Restarting…" : "Restart"}
            </Button>
          )}
          {!detail.installed && (
            <CopyCommand
              label="Copy install command"
              command={`eve add ${detail.id}`}
            />
          )}
          {detail.installed && !detail.alwaysInstall && (
            <CopyCommand
              label="Copy remove command"
              command={`eve remove ${detail.id}`}
            />
          )}
          {detail.container && (
            <CopyCommand
              label="Copy logs command"
              command={`docker logs -f --tail 200 ${detail.container.name}`}
            />
          )}
        </div>
      </Section>

      {/* Monitoring */}
      {detail.container && (
        <Section title="Monitoring" icon={<Activity className="h-4 w-4" />}>
          <ContainerStats detail={detail} />
          {detail.logs && (
            <div className="mt-4">
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-default-400">
                Last 50 log lines
              </p>
              <pre className="max-h-72 overflow-auto rounded-lg border border-divider bg-content2 px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground">
                <code>{detail.logs.trim() || "(no log output)"}</code>
              </pre>
            </div>
          )}
        </Section>
      )}

      {/* Endpoints */}
      {detail.container && (
        <Section title="Endpoints" icon={<Globe className="h-4 w-4" />}>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <KV label="Container" value={<code className="font-mono text-xs text-foreground">{detail.container.name}</code>} />
            {detail.container.inspect?.id && (
              <KV label="Container ID" value={<code className="font-mono text-xs text-foreground">{detail.container.inspect.id}</code>} />
            )}
            {detail.container.inspect?.image && (
              <KV label="Image" value={<code className="font-mono text-xs text-foreground">{detail.container.inspect.image}</code>} />
            )}
            {detail.container.internalPort !== null && (
              <KV label="Internal port" value={<code className="font-mono text-xs text-foreground">{detail.container.internalPort}</code>} />
            )}
            {detail.container.hostPort !== null && (
              <KV label="Host port" value={<code className="font-mono text-xs text-foreground">{detail.container.hostPort}</code>} />
            )}
            {detail.container.subdomain && (
              <KV label="Subdomain" value={<code className="font-mono text-xs text-foreground">{detail.container.subdomain}</code>} />
            )}
          </div>
        </Section>
      )}

      {/* Wiring */}
      {(detail.requires.length > 0 || detail.requiredBy.length > 0) && (
        <Section title="Wiring" icon={<Plug className="h-4 w-4" />}>
          {detail.requires.length > 0 && (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-default-400">
                Depends on
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {detail.requires.map(d => (
                  <Chip key={d.id} size="sm" variant="flat" radius="sm">
                    {d.label}
                  </Chip>
                ))}
              </div>
            </div>
          )}
          {detail.requiredBy.length > 0 && (
            <div className="mt-3">
              <p className="text-[11px] font-medium uppercase tracking-wider text-default-400">
                Required by
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {detail.requiredBy.map(d => (
                  <Chip key={d.id} size="sm" variant="flat" radius="sm" color="primary">
                    {d.label}
                  </Chip>
                ))}
              </div>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Section({
  title, icon, children,
}: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-default-400">
        {icon && <span className="text-default-400">{icon}</span>}
        <span>{title}</span>
      </div>
      {children}
    </section>
  );
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-divider bg-content2/40 px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-wider text-default-400">{label}</p>
      <div className="mt-0.5 truncate">{value}</div>
    </div>
  );
}

function StatusChip({ detail }: { detail: ComponentDetail }) {
  if (!detail.installed) return <Chip size="sm" variant="flat" radius="sm">available</Chip>;
  if (!detail.container) return <Chip size="sm" color="success" variant="flat" radius="sm">ready</Chip>;
  const s = detail.container.inspect?.status;
  if (s === "running") return <Chip size="sm" color="success" variant="flat" radius="sm">running</Chip>;
  if (s === "restarting") return <Chip size="sm" color="warning" variant="flat" radius="sm">restarting</Chip>;
  if (s === "paused") return <Chip size="sm" color="warning" variant="flat" radius="sm">paused</Chip>;
  if (s === "exited") return <Chip size="sm" color="danger" variant="flat" radius="sm">exited</Chip>;
  return <Chip size="sm" variant="flat" radius="sm">unknown</Chip>;
}

function ContainerStats({ detail }: { detail: ComponentDetail }) {
  const inspect = detail.container?.inspect;
  if (!inspect) {
    return (
      <p className="text-sm text-default-500">
        No container running. Eve has nothing to monitor right now.
      </p>
    );
  }

  const startedAt = inspect.startedAt && inspect.startedAt !== "0001-01-01T00:00:00Z"
    ? new Date(inspect.startedAt)
    : null;
  const uptimeMs = startedAt ? Date.now() - startedAt.getTime() : null;

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <KV
        label="Status"
        value={<span className="text-sm text-foreground capitalize">{inspect.status}</span>}
      />
      <KV
        label="Uptime"
        value={
          <span className="text-sm text-foreground">
            {uptimeMs !== null ? formatDuration(uptimeMs) : "—"}
          </span>
        }
      />
      <KV
        label="Restarts"
        value={<span className="text-sm text-foreground tabular-nums">{inspect.restartCount}</span>}
      />
      <KV
        label="Exit code"
        value={
          <span className="text-sm text-foreground tabular-nums">
            {inspect.exitCode !== null ? inspect.exitCode : "—"}
          </span>
        }
      />
    </div>
  );
}

function CopyCommand({ label, command }: { label: string; command: string }) {
  const [copied, setCopied] = useState(false);
  return (
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
      {label}
    </Button>
  );
}

function formatDuration(ms: number): string {
  if (ms < 0) return "—";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ${min % 60}m`;
  const d = Math.floor(hr / 24);
  return `${d}d ${hr % 24}h`;
}
