"use client";

/**
 * Inbox — Notifications panel.
 *
 * USER channel — the panel reads the operator's notification stream
 * straight from the pod via tRPC over `/api/pod/*`. The pod-side
 * router (`notifCenter.*` in synap-backend) is `workspaceProcedure`,
 * so every call carries `x-workspace-id` plumbed through the
 * `useActiveWorkspace` hook + `podTrpcFetch` helper.
 *
 *   List:        GET  /api/pod/trpc/notifCenter.list
 *                input { status: "all" | "unread" | "read" | "dismissed",
 *                        limit?, offset?, category? }
 *   Mark read:   POST /api/pod/trpc/notifCenter.markRead
 *                input { notificationId }
 *   Mark all:    POST /api/pod/trpc/notifCenter.markAllRead
 *
 * Each row exposes:
 *   • Category color chip (info / success / warning / danger).
 *   • Title + message.
 *   • Relative timestamp.
 *   • Click area — when the notification carries an `actionUrl`,
 *     clicking opens it in a new tab. Mark-read is a separate mutation.
 *
 * "Mark all read" is shown only when at least one row is unread.
 *
 * Pre-workspace guard: when `useActiveWorkspace` hasn't resolved yet
 * (no cached id and the `workspaces.list` call is still in flight) we
 * render the loader. If it resolves to `null` (no pod session, no
 * memberships) we render the empty state — `notifCenter.list` would
 * 401 otherwise and that's noisier than necessary.
 */

import { useCallback, useMemo, useState } from "react";
import { Card, Chip, addToast } from "@heroui/react";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Info,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PanelEmpty, PanelError, PanelLoader } from "./panel-states";
import { podTrpcFetch } from "@/lib/pod-fetch";
import { usePodQuery } from "@/lib/use-pod-query";

// Pod severity is a wider enum (info|success|warning|error|critical) but
// the panel collapses critical → danger and treats error as danger. We
// keep the local enum tight so the styling table stays exhaustive.
type NotificationCategory = "info" | "success" | "warning" | "danger";

/** A single row in the wire response (`notifCenter.list` / `.listAll`). */
interface WireNotification {
  id: string;
  type: string;
  title?: string | null;
  message?: string | null;
  /** Pod field; we map to NotificationCategory below. */
  severity?: string | null;
  status?: "unread" | "read" | "dismissed" | null;
  createdAt?: string | Date | null;
  actionUrl?: string | null;
  data?: Record<string, unknown> | null;
  /** Workspace the notification belongs to. Null = pod-wide.
   *  Needed so per-row mark-read can target the right workspace. */
  workspaceId?: string | null;
}

interface NotifListResponse {
  notifications: WireNotification[];
  total: number;
}

const SEVERITY_TO_CATEGORY: Record<string, NotificationCategory> = {
  info: "info",
  success: "success",
  warning: "warning",
  error: "danger",
  critical: "danger",
};

function severityToCategory(s: string | null | undefined): NotificationCategory {
  if (!s) return "info";
  return SEVERITY_TO_CATEGORY[s.toLowerCase()] ?? "info";
}

export function NotificationsPanel() {
  // Single canonical query — scope-aware via `usePodQuery`. In Eve OS
  // (user-wide scope) this routes to `notifCenter.listAll`; in any future
  // workspace-scoped surface it routes to `notifCenter.list` with the
  // workspace header. No more `useActiveWorkspace` plumbing here.
  const { state, refresh } = usePodQuery<NotifListResponse>(
    "notifCenter.list",
    { status: "all", limit: 50 },
    { userWideProcedure: "notifCenter.listAll" },
  );

  // Local optimistic copy — needed so mark-read can flip rows immediately
  // without waiting on a refresh round-trip.
  const [localOverrides, setLocalOverrides] = useState<
    Record<string, WireNotification["status"]>
  >({});

  const items: WireNotification[] = useMemo(() => {
    if (state.kind !== "ready") return [];
    const wire = Array.isArray(state.data?.notifications)
      ? state.data.notifications
      : [];
    return wire.map((n) =>
      localOverrides[n.id]
        ? { ...n, status: localOverrides[n.id] }
        : n,
    );
  }, [state, localOverrides]);

  const unreadCount = useMemo(
    () => items.filter((n) => n.status === "unread").length,
    [items],
  );

  const handleMarkAllRead = useCallback(async () => {
    const targets = items.filter((n) => n.status === "unread");
    if (targets.length === 0) return;
    // Optimistic flip first.
    setLocalOverrides((prev) => {
      const next = { ...prev };
      for (const n of targets) next[n.id] = "read";
      return next;
    });
    // Fan out per workspace — `notifCenter.markAllRead` is workspaceProcedure,
    // so we group unread rows by source workspace and one shot each.
    const byWorkspace = new Map<string | null, WireNotification[]>();
    for (const n of targets) {
      const key = n.workspaceId ?? null;
      const list = byWorkspace.get(key) ?? [];
      list.push(n);
      byWorkspace.set(key, list);
    }
    const results = await Promise.allSettled(
      Array.from(byWorkspace.entries()).map(([ws]) =>
        podTrpcFetch<{ success: boolean }>(
          "notifCenter.markAllRead",
          undefined,
          { method: "POST", workspaceId: ws },
        ),
      ),
    );
    if (results.some((r) => r.status === "rejected")) {
      addToast({ title: "Mark-as-read sync partially failed", color: "warning" });
    }
  }, [items]);

  const handleOpen = useCallback(async (n: WireNotification) => {
    if (n.actionUrl) {
      window.open(n.actionUrl, "_blank", "noopener,noreferrer");
    }
    if (n.status !== "unread") return;
    // Optimistic flip
    setLocalOverrides((prev) => ({ ...prev, [n.id]: "read" }));
    try {
      await podTrpcFetch<{ success: boolean }>(
        "notifCenter.markRead",
        { notificationId: n.id },
        { method: "POST", workspaceId: n.workspaceId ?? null },
      );
    } catch {
      /* leave optimistic flip — next refresh reconciles */
    }
  }, []);

  // ─── Render guards ────────────────────────────────────────────────────────

  if (state.kind === "loading") return <PanelLoader />;
  if (state.kind === "unpaired") {
    return (
      <PanelEmpty
        icon={Bell}
        title="Pair your pod"
        hint="Once your Eve is paired with a Synap pod, alerts will appear here."
      />
    );
  }
  if (state.kind === "error") {
    return <PanelError message={state.message} onRetry={refresh} />;
  }
  if (items.length === 0) {
    return (
      <PanelEmpty
        icon={Bell}
        title="No notifications"
        hint="System alerts, AI nudges, and connector events will surface here."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {unreadCount > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-[12px] text-foreground/55">
            {unreadCount} unread
          </p>
          <button
            type="button"
            onClick={handleMarkAllRead}
            className="
              text-[12px] font-medium text-primary hover:underline
            "
          >
            Mark all read
          </button>
        </div>
      )}
      {items.map((n) => (
        <NotificationRow key={n.id} n={n} onOpen={handleOpen} />
      ))}
    </div>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────────

const CATEGORY_ICON: Record<NotificationCategory, LucideIcon> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
};

const CATEGORY_TONE: Record<NotificationCategory, string> = {
  info: "text-foreground/65 bg-foreground/[0.06]",
  success: "text-success bg-success/15",
  warning: "text-warning bg-warning/15",
  danger: "text-danger bg-danger/15",
};

function NotificationRow({
  n,
  onOpen,
}: {
  n: WireNotification;
  onOpen: (n: WireNotification) => void;
}) {
  const cat: NotificationCategory = severityToCategory(n.severity);
  const Icon = CATEGORY_ICON[cat];
  const isUnread = n.status === "unread";
  const clickable = !!n.actionUrl;

  return (
    <Card
      isPressable={clickable}
      onPress={clickable ? () => onOpen(n) : undefined}
      radius="md"
      shadow="none"
      className={
        "flex w-full flex-col gap-2 p-4 text-left " +
        "bg-foreground/[0.04] " +
        "ring-1 ring-inset ring-foreground/10 " +
        (clickable ? "transition-colors hover:bg-foreground/[0.07] " : "") +
        (isUnread ? "ring-foreground/20" : "")
      }
    >
      <div className="flex items-start gap-3">
        <span
          className={
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-md " +
            CATEGORY_TONE[cat]
          }
          aria-hidden
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={2.2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h3 className="truncate text-[13.5px] font-medium text-foreground">
              {n.title ?? prettyType(n.type)}
            </h3>
            {isUnread && (
              <Chip
                size="sm"
                variant="flat"
                color="primary"
                className="h-4 px-1 text-[10px] font-medium"
              >
                New
              </Chip>
            )}
          </div>
          {n.message && (
            <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-foreground/65">
              {n.message}
            </p>
          )}
          <div className="mt-1 flex items-center gap-2 text-[11px] text-foreground/45">
            <span>{n.type}</span>
            {n.createdAt && (
              <>
                <span className="text-foreground/30">·</span>
                <span>{relativeTime(n.createdAt)}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

function prettyType(type: string): string {
  // notification.skill_triggered → "Skill triggered"
  const last = type.split(".").pop() ?? type;
  return last
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

function relativeTime(ts: string | Date): string {
  const t = ts instanceof Date ? ts.getTime() : new Date(ts).getTime();
  if (Number.isNaN(t)) return typeof ts === "string" ? ts : "";
  const diff = Date.now() - t;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(t).toLocaleDateString();
}
