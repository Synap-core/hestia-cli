"use client";

/**
 * Component detail drawer — slide-in from right.
 *
 * Shows everything about one component: what it is, why your stack uses it,
 * live container monitoring, real lifecycle actions (start / stop / restart /
 * update / remove), live log stream, plus copy-CLI for install (the only
 * action that still lives on the host).
 */

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Drawer, DrawerContent, DrawerHeader, DrawerBody, DrawerFooter,
  Spinner, Button, Chip, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
  addToast,
} from "@heroui/react";
import {
  RefreshCw, RotateCcw, ExternalLink, Copy, Check, X, Globe,
  Activity, Plug, FileText, Power, PowerOff, ArrowDownToLine, Trash2,
  Terminal, Pause, Play, Settings,
} from "lucide-react";
import { RsshubFeedsPanel } from "./config-panels/rsshub-feeds";
import { OpenclawConfigPanel } from "./config-panels/openclaw-config";
import { HermesConfigPanel } from "./config-panels/hermes-config";
import { SynapConfigPanel } from "./config-panels/synap-config";

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

type LifecycleAction = "install" | "start" | "stop" | "restart" | "update" | "remove";

type LifecycleEvent =
  | { type: "step"; label: string }
  | { type: "log"; line: string }
  | { type: "done"; summary: string }
  | { type: "error"; message: string };

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
  const [running, setRunning] = useState<LifecycleAction | null>(null);
  const [progress, setProgress] = useState<LifecycleEvent[]>([]);
  const [confirm, setConfirm] = useState<LifecycleAction | null>(null);

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
      setProgress([]);
      setRunning(null);
      return;
    }
    void fetchDetail();
  }, [isOpen, componentId, fetchDetail]);

  /**
   * Run a lifecycle action against the component, streaming progress events
   * back via SSE-over-fetch. The drawer's progress panel updates live.
   */
  const runLifecycle = useCallback(async (action: LifecycleAction) => {
    if (!componentId) return;
    setRunning(action);
    setProgress([{ type: "step", label: `Starting ${action}…` }]);

    try {
      const res = await fetch(`/api/components/${componentId}?stream=1`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action }),
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        addToast({ title: err.error ?? `${action} failed`, color: "danger" });
        setProgress(p => [...p, { type: "error", message: err.error ?? "stream failed" }]);
        return;
      }

      let final: LifecycleEvent | null = null;
      for await (const ev of parseSseStream(res.body)) {
        setProgress(p => [...p, ev]);
        if (ev.type === "done" || ev.type === "error") final = ev;
      }

      if (final?.type === "done") {
        addToast({ title: final.summary, color: "success" });
      } else if (final?.type === "error") {
        addToast({ title: final.message, color: "danger" });
      }

      // Re-fetch to reflect new container state.
      setTimeout(() => { void fetchDetail(true); onChange?.(); }, 800);
    } catch (err) {
      const message = err instanceof Error ? err.message : `${action} failed`;
      addToast({ title: message, color: "danger" });
      setProgress(p => [...p, { type: "error", message }]);
    } finally {
      setRunning(null);
    }
  }, [componentId, fetchDetail, onChange]);

  // Confirmation modal target — Remove + Update need an "are you sure" step.
  const requestAction = (action: LifecycleAction) => {
    if (action === "remove" || action === "update") setConfirm(action);
    else void runLifecycle(action);
  };

  return (
    <>
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
                  <DetailBody
                    detail={detail}
                    running={running}
                    progress={progress}
                    onAction={requestAction}
                  />
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

      <ConfirmModal
        action={confirm}
        label={detail?.label ?? ""}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const a = confirm;
          setConfirm(null);
          if (a) void runLifecycle(a);
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------

function DetailBody({
  detail, running, progress, onAction,
}: {
  detail: ComponentDetail;
  running: LifecycleAction | null;
  progress: LifecycleEvent[];
  onAction: (a: LifecycleAction) => void;
}) {
  const longDesc = detail.longDescription ?? detail.description;
  const paragraphs = longDesc.split(/\n\s*\n/).filter(Boolean);
  const status = detail.container?.inspect?.status;
  const isRunning = status === "running";
  const isStopped = status === "exited" || status === "paused";
  const hasContainer = detail.container !== null;
  const canRemove = detail.installed && !detail.alwaysInstall;
  const canUpdate = detail.installed && hasContainer;

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
          {detail.container?.domainUrl && isRunning && (
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

          {hasContainer && isStopped && (
            <ActionButton
              icon={<Play className="h-3.5 w-3.5" />}
              label="Start"
              busyLabel="Starting…"
              busy={running === "start"}
              disabled={running !== null}
              onPress={() => onAction("start")}
            />
          )}

          {hasContainer && isRunning && (
            <ActionButton
              icon={<Pause className="h-3.5 w-3.5" />}
              label="Stop"
              busyLabel="Stopping…"
              busy={running === "stop"}
              disabled={running !== null}
              onPress={() => onAction("stop")}
            />
          )}

          {hasContainer && (
            <ActionButton
              icon={<RotateCcw className="h-3.5 w-3.5" />}
              label="Restart"
              busyLabel="Restarting…"
              busy={running === "restart"}
              disabled={running !== null || !isRunning}
              onPress={() => onAction("restart")}
            />
          )}

          {canUpdate && (
            <ActionButton
              icon={<ArrowDownToLine className="h-3.5 w-3.5" />}
              label="Update"
              busyLabel="Updating…"
              busy={running === "update"}
              disabled={running !== null}
              onPress={() => onAction("update")}
            />
          )}

          {canRemove && (
            <ActionButton
              icon={<Trash2 className="h-3.5 w-3.5" />}
              label="Remove"
              busyLabel="Removing…"
              busy={running === "remove"}
              disabled={running !== null}
              onPress={() => onAction("remove")}
              tone="danger"
            />
          )}

          {!detail.installed && (
            <ActionButton
              icon={<ArrowDownToLine className="h-3.5 w-3.5" />}
              label="Install"
              busyLabel="Installing…"
              busy={running === "install"}
              disabled={running !== null}
              onPress={() => onAction("install")}
            />
          )}
        </div>

        {/* Live progress feed for the in-flight action. Drains automatically
            once the user opens a different component. */}
        {progress.length > 0 && (
          <ProgressFeed progress={progress} active={running !== null} />
        )}
      </Section>

      {/* Component-specific configuration. Only renders for components
          we've built panels for; everything else just gets the standard
          monitoring + logs sections. */}
      <ComponentConfigPanel id={detail.id} installed={detail.installed} />

      {/* Monitoring */}
      {detail.container && (
        <Section title="Monitoring" icon={<Activity className="h-4 w-4" />}>
          <ContainerStats detail={detail} />
        </Section>
      )}

      {/* Live logs */}
      {detail.container && (
        <Section title="Logs" icon={<Terminal className="h-4 w-4" />}>
          <LiveLogs componentId={detail.id} initial={detail.logs} />
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

function ActionButton({
  icon, label, busyLabel, busy, disabled, tone, onPress,
}: {
  icon: React.ReactNode;
  label: string;
  busyLabel: string;
  busy: boolean;
  disabled: boolean;
  tone?: "danger";
  onPress: () => void;
}) {
  return (
    <Button
      size="sm"
      variant="bordered"
      radius="md"
      color={tone === "danger" ? "danger" : "default"}
      startContent={!busy ? icon : undefined}
      isLoading={busy}
      isDisabled={disabled}
      onPress={onPress}
    >
      {busy ? busyLabel : label}
    </Button>
  );
}

function CopyCommand({
  icon, label, command, hint,
}: { icon?: React.ReactNode; label: string; command: string; hint?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="bordered"
      radius="md"
      startContent={copied ? <Check className="h-3.5 w-3.5 text-primary" /> : (icon ?? <Copy className="h-3.5 w-3.5" />)}
      onPress={() => {
        void navigator.clipboard.writeText(command).then(() => {
          setCopied(true);
          addToast({
            title: "Command copied",
            description: hint,
            color: "success",
          });
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {label}
    </Button>
  );
}

/** Live progress panel for an in-flight lifecycle action. */
function ProgressFeed({
  progress, active,
}: { progress: LifecycleEvent[]; active: boolean }) {
  const ref = useRef<HTMLPreElement>(null);

  // Auto-scroll to bottom on new events while the action is active.
  useEffect(() => {
    if (active && ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [progress, active]);

  return (
    <div className="mt-4">
      <p className="mb-1.5 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-default-400">
        <span>Progress</span>
        {active && <Spinner size="sm" color="primary" />}
      </p>
      <pre
        ref={ref}
        className="max-h-60 overflow-auto rounded-lg border border-divider bg-content2 px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground"
      >
        <code>
          {progress.map((ev, i) => (
            <ProgressLine key={i} ev={ev} />
          ))}
        </code>
      </pre>
    </div>
  );
}

function ProgressLine({ ev }: { ev: LifecycleEvent }) {
  if (ev.type === "step") return <div className="text-primary">▶ {ev.label}</div>;
  if (ev.type === "log") return <div className="text-default-700">{ev.line}</div>;
  if (ev.type === "done") return <div className="text-success font-medium">✓ {ev.summary}</div>;
  return <div className="text-danger font-medium">✗ {ev.message}</div>;
}

/** Live log feed — toggleable follow stream over SSE. */
function LiveLogs({
  componentId, initial,
}: { componentId: string; initial: string | null }) {
  const [lines, setLines] = useState<string[]>(() =>
    initial ? initial.split("\n").filter(l => l.length > 0) : [],
  );
  const [following, setFollowing] = useState(false);
  const ref = useRef<HTMLPreElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Stop following when component changes or unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  // Reset on component switch.
  useEffect(() => {
    setLines(initial ? initial.split("\n").filter(l => l.length > 0) : []);
    setFollowing(false);
    abortRef.current?.abort();
    abortRef.current = null;
  }, [componentId, initial]);

  // Auto-scroll while following.
  useEffect(() => {
    if (following && ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [lines, following]);

  const startFollowing = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setFollowing(true);

    try {
      const res = await fetch(`/api/components/${componentId}/logs?stream=1&tail=200`, {
        credentials: "include",
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        addToast({ title: "Couldn't stream logs", color: "danger" });
        setFollowing(false);
        return;
      }

      // Reset to a fresh stream — `tail=200` already gives us the recent
      // history, no need to keep the static snapshot.
      setLines([]);

      for await (const ev of parseSseLineStream(res.body)) {
        if (ev.line) setLines(prev => prev.length > 2000 ? [...prev.slice(-1500), ev.line] : [...prev, ev.line]);
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        addToast({ title: "Log stream ended", color: "warning" });
      }
    } finally {
      setFollowing(false);
    }
  }, [componentId]);

  const stopFollowing = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setFollowing(false);
  }, []);

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wider text-default-400">
          {following ? "Live tail" : "Last 50 lines"}
        </p>
        <div className="flex items-center gap-1">
          {following ? (
            <Button
              size="sm"
              variant="light"
              radius="md"
              startContent={<PowerOff className="h-3.5 w-3.5" />}
              onPress={stopFollowing}
            >
              Stop
            </Button>
          ) : (
            <Button
              size="sm"
              variant="light"
              radius="md"
              startContent={<Power className="h-3.5 w-3.5" />}
              onPress={() => void startFollowing()}
            >
              Follow
            </Button>
          )}
          <Button
            size="sm"
            variant="light"
            radius="md"
            startContent={<X className="h-3.5 w-3.5" />}
            onPress={() => setLines([])}
          >
            Clear
          </Button>
        </div>
      </div>
      <pre
        ref={ref}
        className="max-h-72 overflow-auto rounded-lg border border-divider bg-content2 px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground"
      >
        <code>{lines.length > 0 ? lines.join("\n") : "(no log output)"}</code>
      </pre>
    </div>
  );
}

/**
 * Per-component configuration. Each case here gets a Section wrapper with
 * the component's own UI; missing cases render nothing (no extra section).
 */
function ComponentConfigPanel({ id, installed }: { id: string; installed: boolean }) {
  if (!installed) return null;

  if (id === "rsshub") {
    return (
      <Section title="Feeds" icon={<Settings className="h-4 w-4" />}>
        <RsshubFeedsPanel />
      </Section>
    );
  }

  if (id === "openclaw") {
    return (
      <Section title="Configuration" icon={<Settings className="h-4 w-4" />}>
        <OpenclawConfigPanel />
      </Section>
    );
  }

  if (id === "hermes") {
    return (
      <Section title="Daemon" icon={<Settings className="h-4 w-4" />}>
        <HermesConfigPanel />
      </Section>
    );
  }

  if (id === "synap") {
    return (
      <Section title="Pod" icon={<Settings className="h-4 w-4" />}>
        <SynapConfigPanel />
      </Section>
    );
  }

  return null;
}

function ConfirmModal({
  action, label, onCancel, onConfirm,
}: {
  action: LifecycleAction | null;
  label: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const isOpen = action !== null;
  const isRemove = action === "remove";

  return (
    <Modal isOpen={isOpen} onClose={onCancel} size="sm">
      <ModalContent>
        {() => (
          <>
            <ModalHeader>
              {isRemove ? `Remove ${label}?` : `Update ${label}?`}
            </ModalHeader>
            <ModalBody>
              <p className="text-sm text-default-600">
                {isRemove ? (
                  <>
                    This stops and removes the container. <span className="font-medium">Volumes are deleted</span> for compose-managed components — your data may be lost.
                  </>
                ) : (
                  <>This pulls the latest image and recreates the container. Brief downtime is expected.</>
                )}
              </p>
            </ModalBody>
            <ModalFooter>
              <Button size="sm" variant="light" onPress={onCancel}>Cancel</Button>
              <Button
                size="sm"
                color={isRemove ? "danger" : "primary"}
                onPress={onConfirm}
              >
                {isRemove ? "Remove" : "Update"}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// SSE parsers
// ---------------------------------------------------------------------------

/**
 * Parse an SSE stream of `data: <json LifecycleEvent>` lines.
 * Yields one event per `data:` block.
 */
async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<LifecycleEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE messages are separated by blank lines.
    const messages = buffer.split("\n\n");
    buffer = messages.pop() ?? "";

    for (const msg of messages) {
      const dataLine = msg.split("\n").find(l => l.startsWith("data:"));
      if (!dataLine) continue;
      const json = dataLine.slice(5).trim();
      if (!json) continue;
      try {
        yield JSON.parse(json) as LifecycleEvent;
      } catch {
        // Ignore malformed messages — keepalives and `event: end` blocks
        // arrive without `data:` and don't reach us anyway.
      }
    }
  }
}

/** Specialised version for the log stream — yields `{line}` payloads. */
async function* parseSseLineStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<{ line: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const messages = buffer.split("\n\n");
    buffer = messages.pop() ?? "";

    for (const msg of messages) {
      const dataLine = msg.split("\n").find(l => l.startsWith("data:"));
      if (!dataLine) continue;
      const json = dataLine.slice(5).trim();
      if (!json) continue;
      try {
        yield JSON.parse(json) as { line: string };
      } catch {
        /* ignore */
      }
    }
  }
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
