"use client";

/**
 * ComponentSurface — the full per-component view.
 *
 * Renders About / Actions / Config / Monitoring / Logs / Endpoints / Wiring
 * for one component. State (fetching, running action, progress feed, log
 * stream) lives here so both the drawer (slide-in) and the full-page route
 * (`/dashboard/components/[id]`) can use it without duplicating logic.
 *
 * `layout="drawer"` keeps spacing tight — the drawer's own header already
 * shows the title + status. `layout="page"` adds a top header with the
 * label + a back link to the catalog.
 */

import {
  useEffect, useRef, useState, useCallback, type ReactNode,
} from "react";
import Link from "next/link";
import {
  Spinner, Button, Chip, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
  addToast,
} from "@heroui/react";
import {
  RotateCcw, ExternalLink, X, Globe,
  Activity, Plug, FileText, Power, PowerOff, ArrowDownToLine, Trash2,
  Terminal, Pause, Play, Settings, ChevronLeft,
} from "lucide-react";
import { RsshubFeedsPanel } from "./config-panels/rsshub-feeds";
import { OpenclawConfigPanel } from "./config-panels/openclaw-config";
import { HermesConfigPanel } from "./config-panels/hermes-config";
import { SynapConfigPanel } from "./config-panels/synap-config";
import { OpenwebuiConfigPanel } from "./config-panels/openwebui-config";

// ---------------------------------------------------------------------------
// Shared types — kept here so the drawer + page consume the same shape
// ---------------------------------------------------------------------------

export interface ComponentDetail {
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
// Public component
// ---------------------------------------------------------------------------

export interface ComponentSurfaceProps {
  componentId: string;
  /** drawer = embedded inside <Drawer>, page = full-page route. */
  layout: "drawer" | "page";
  /** Called when state changes that the parent might care about (catalog row update, drawer close). */
  onChange?: () => void;
}

export function ComponentSurface({
  componentId, layout, onChange,
}: ComponentSurfaceProps) {
  const [detail, setDetail] = useState<ComponentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<LifecycleAction | null>(null);
  const [progress, setProgress] = useState<LifecycleEvent[]>([]);
  const [confirm, setConfirm] = useState<LifecycleAction | null>(null);

  const fetchDetail = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch(`/api/components/${componentId}`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json() as ComponentDetail;
        setDetail(data);
      }
    } finally {
      setLoading(false);
    }
  }, [componentId]);

  // Reset when componentId changes (drawer mode reuses one instance).
  useEffect(() => {
    setDetail(null);
    setLoading(true);
    setProgress([]);
    setRunning(null);
    void fetchDetail();
  }, [componentId, fetchDetail]);

  /** Run a lifecycle action and stream progress events back into `progress`. */
  const runLifecycle = useCallback(async (action: LifecycleAction) => {
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

      if (final?.type === "done") addToast({ title: final.summary, color: "success" });
      else if (final?.type === "error") addToast({ title: final.message, color: "danger" });

      setTimeout(() => { void fetchDetail(true); onChange?.(); }, 800);
    } catch (err) {
      const message = err instanceof Error ? err.message : `${action} failed`;
      addToast({ title: message, color: "danger" });
      setProgress(p => [...p, { type: "error", message }]);
    } finally {
      setRunning(null);
    }
  }, [componentId, fetchDetail, onChange]);

  const requestAction = (action: LifecycleAction) => {
    if (action === "remove" || action === "update") setConfirm(action);
    else void runLifecycle(action);
  };

  // ─── Render states ───────────────────────────────────────────────────────

  if (loading || !detail) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-default-500">
        <Spinner size="lg" color="primary" />
        <p className="text-sm">Loading component…</p>
      </div>
    );
  }

  return (
    <>
      {/* Page-only header — drawer mode has its own DrawerHeader */}
      {layout === "page" && (
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <Link
              href="/dashboard/components"
              className="inline-flex items-center gap-1 text-sm font-medium text-default-500 hover:text-primary"
            >
              <ChevronLeft className="h-4 w-4" />
              Components
            </Link>
            <div className="mt-2 flex items-start gap-3">
              <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary text-2xl">
                <span aria-hidden>{detail.emoji}</span>
              </span>
              <div className="min-w-0">
                <h1 className="font-heading text-3xl font-medium tracking-tightest text-foreground truncate">
                  {detail.label}
                </h1>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <StatusChip detail={detail} />
                  {detail.recordedVersion && (
                    <span className="font-mono text-xs text-default-400">
                      v{detail.recordedVersion}
                    </span>
                  )}
                  <span className="text-xs text-default-400">{detail.category}</span>
                </div>
              </div>
            </div>
          </div>
        </header>
      )}

      <DetailBody
        detail={detail}
        running={running}
        progress={progress}
        layout={layout}
        onAction={requestAction}
      />

      <ConfirmModal
        action={confirm}
        label={detail.label}
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
// Body — same content in both layouts; spacing tweaks via `layout`
// ---------------------------------------------------------------------------

function DetailBody({
  detail, running, progress, layout, onAction,
}: {
  detail: ComponentDetail;
  running: LifecycleAction | null;
  progress: LifecycleEvent[];
  layout: "drawer" | "page";
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

  // Page layout uses two-column grid for endpoints/wiring, drawer uses a
  // single column. Sections themselves are identical.
  const containerClass = layout === "page"
    ? "space-y-10"
    : "space-y-8";

  return (
    <div className={containerClass}>
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
        </div>

        {progress.length > 0 && (
          <ProgressFeed progress={progress} active={running !== null} />
        )}
      </Section>

      <ComponentConfigPanel id={detail.id} installed={detail.installed} />

      {detail.container && (
        <Section title="Monitoring" icon={<Activity className="h-4 w-4" />}>
          <ContainerStats detail={detail} />
        </Section>
      )}

      {detail.container && (
        <Section title="Logs" icon={<Terminal className="h-4 w-4" />}>
          <LiveLogs componentId={detail.id} initial={detail.logs} />
        </Section>
      )}

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

      {(detail.requires.length > 0 || detail.requiredBy.length > 0) && (
        <Section title="Wiring" icon={<Plug className="h-4 w-4" />}>
          {detail.requires.length > 0 && (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-default-400">
                Depends on
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {detail.requires.map(d => (
                  <Link
                    key={d.id}
                    href={`/dashboard/components/${d.id}`}
                    className="inline-block"
                  >
                    <Chip size="sm" variant="flat" radius="sm" className="cursor-pointer hover:bg-content3">
                      {d.label}
                    </Chip>
                  </Link>
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
                  <Link
                    key={d.id}
                    href={`/dashboard/components/${d.id}`}
                    className="inline-block"
                  >
                    <Chip size="sm" variant="flat" radius="sm" color="primary" className="cursor-pointer hover:opacity-80">
                      {d.label}
                    </Chip>
                  </Link>
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
}: { title: string; icon?: ReactNode; children: ReactNode }) {
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

function KV({ label, value }: { label: string; value: ReactNode }) {
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
      <KV label="Status" value={<span className="text-sm text-foreground capitalize">{inspect.status}</span>} />
      <KV label="Uptime" value={<span className="text-sm text-foreground">{uptimeMs !== null ? formatDuration(uptimeMs) : "—"}</span>} />
      <KV label="Restarts" value={<span className="text-sm text-foreground tabular-nums">{inspect.restartCount}</span>} />
      <KV label="Exit code" value={<span className="text-sm text-foreground tabular-nums">{inspect.exitCode !== null ? inspect.exitCode : "—"}</span>} />
    </div>
  );
}

function ActionButton({
  icon, label, busyLabel, busy, disabled, tone, onPress,
}: {
  icon: ReactNode;
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

function ProgressFeed({ progress, active }: { progress: LifecycleEvent[]; active: boolean }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (active && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
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
          {progress.map((ev, i) => <ProgressLine key={i} ev={ev} />)}
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

function LiveLogs({ componentId, initial }: { componentId: string; initial: string | null }) {
  const [lines, setLines] = useState<string[]>(() =>
    initial ? initial.split("\n").filter(l => l.length > 0) : [],
  );
  const [following, setFollowing] = useState(false);
  const ref = useRef<HTMLPreElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    setLines(initial ? initial.split("\n").filter(l => l.length > 0) : []);
    setFollowing(false);
    abortRef.current?.abort();
    abortRef.current = null;
  }, [componentId, initial]);

  useEffect(() => {
    if (following && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
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
            <Button size="sm" variant="light" radius="md" startContent={<PowerOff className="h-3.5 w-3.5" />} onPress={stopFollowing}>
              Stop
            </Button>
          ) : (
            <Button size="sm" variant="light" radius="md" startContent={<Power className="h-3.5 w-3.5" />} onPress={() => void startFollowing()}>
              Follow
            </Button>
          )}
          <Button size="sm" variant="light" radius="md" startContent={<X className="h-3.5 w-3.5" />} onPress={() => setLines([])}>
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
            <ModalHeader>{isRemove ? `Remove ${label}?` : `Update ${label}?`}</ModalHeader>
            <ModalBody>
              <p className="text-sm text-default-600">
                {isRemove ? (
                  <>This stops and removes the container. <span className="font-medium">Volumes are deleted</span> for compose-managed components — your data may be lost.</>
                ) : (
                  <>This pulls the latest image and recreates the container. Brief downtime is expected.</>
                )}
              </p>
            </ModalBody>
            <ModalFooter>
              <Button size="sm" variant="light" onPress={onCancel}>Cancel</Button>
              <Button size="sm" color={isRemove ? "danger" : "primary"} onPress={onConfirm}>
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
// Per-component config panel dispatcher
// ---------------------------------------------------------------------------

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
  if (id === "openwebui") {
    return (
      <Section title="Chat" icon={<Settings className="h-4 w-4" />}>
        <OpenwebuiConfigPanel />
      </Section>
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// SSE helpers + utilities
// ---------------------------------------------------------------------------

async function* parseSseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<LifecycleEvent> {
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
      try { yield JSON.parse(json) as LifecycleEvent; } catch { /* ignore */ }
    }
  }
}

async function* parseSseLineStream(body: ReadableStream<Uint8Array>): AsyncGenerator<{ line: string }> {
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
      try { yield JSON.parse(json) as { line: string }; } catch { /* ignore */ }
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

// Re-export for places that imported from the old drawer module.
export { StatusChip };
