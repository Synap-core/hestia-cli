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

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { useActiveWorkspace } from "../../hooks/use-active-workspace";
import { podTrpcFetch } from "../lib/pod-fetch";

// Pod severity is a wider enum (info|success|warning|error|critical) but
// the panel collapses critical → danger and treats error as danger. We
// keep the local enum tight so the styling table stays exhaustive.
type NotificationCategory = "info" | "success" | "warning" | "danger";

/** A single row in the wire response (`notifCenter.list`). */
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
}

interface NotifListResponse {
  notifications: WireNotification[];
  total: number;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; items: WireNotification[] }
  | { kind: "error"; message: string };

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
  const {
    workspaceId,
    isLoading: workspaceLoading,
  } = useActiveWorkspace();
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });

  const fetchAll = useCallback(async () => {
    if (!workspaceId) {
      // Nothing to fetch yet — the outer effect will retrigger when
      // workspaceId resolves (or stays null and we render empty).
      return;
    }
    setLoad({ kind: "loading" });
    try {
      // status: "all" — the panel renders unread badges on individual
      // rows but otherwise mixes read + unread in chronological order.
      const data = await podTrpcFetch<NotifListResponse>(
        "notifCenter.list",
        { status: "all", limit: 50 },
        { workspaceId },
      );
      const items = Array.isArray(data?.notifications) ? data.notifications : [];
      setLoad({ kind: "ready", items });
    } catch (err) {
      setLoad({
        kind: "error",
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  }, [workspaceId]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const unreadCount = useMemo(() => {
    if (load.kind !== "ready") return 0;
    return load.items.filter((n) => n.status === "unread").length;
  }, [load]);

  const handleMarkAllRead = useCallback(async () => {
    if (load.kind !== "ready" || !workspaceId) return;
    const targets = load.items.filter((n) => n.status === "unread");
    if (targets.length === 0) return;
    // Optimistic local flip — the mutation is best-effort.
    setLoad((prev) =>
      prev.kind === "ready"
        ? {
            kind: "ready",
            items: prev.items.map((n) =>
              n.status === "unread" ? { ...n, status: "read" } : n,
            ),
          }
        : prev,
    );
    try {
      await podTrpcFetch<{ success: boolean }>(
        "notifCenter.markAllRead",
        undefined,
        { method: "POST", workspaceId },
      );
    } catch {
      // The local flip already happened; a future fetchAll will reconcile.
      addToast({
        title: "Mark-as-read sync failed",
        color: "warning",
      });
    }
  }, [load, workspaceId]);

  const handleOpen = useCallback(
    async (n: WireNotification) => {
      if (n.actionUrl) {
        window.open(n.actionUrl, "_blank", "noopener,noreferrer");
      }
      if (n.status !== "unread" || !workspaceId) return;
      // Best-effort mark-read on click.
      try {
        await podTrpcFetch<{ success: boolean }>(
          "notifCenter.markRead",
          { notificationId: n.id },
          { method: "POST", workspaceId },
        );
      } catch {
        /* swallow — visual stays consistent */
      }
    },
    [workspaceId],
  );

  // ─── Render guards ────────────────────────────────────────────────────────

  // Workspace resolver still working — show loader; the panel re-renders
  // automatically once the hook reports either an id or a final null.
  if (workspaceLoading) return <PanelLoader />;

  // No workspace at all (no pod session, no memberships). Don't bother
  // calling the pod — surface a friendly empty.
  if (!workspaceId) {
    return (
      <PanelEmpty
        icon={Bell}
        title="No workspace yet"
        hint="Once your pod is paired and you’ve joined a workspace, alerts will appear here."
      />
    );
  }

  if (load.kind === "loading") return <PanelLoader />;
  if (load.kind === "error") {
    return <PanelError message={load.message} onRetry={fetchAll} />;
  }
  if (load.items.length === 0) {
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
      {load.items.map((n) => (
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
