"use client";

/**
 * Inbox — Notifications panel.
 *
 * Reads the unified notification stream from the pod via
 * `GET /api/hub/notifications`. Each row exposes:
 *
 *   • Category color chip (info / success / warning / danger).
 *   • Title + message.
 *   • Relative timestamp.
 *   • Click area — when the notification carries an `actionUrl`,
 *     clicking opens it in a new tab. Mark-read is a separate POST.
 *
 * "Mark all read" is shown only when at least one row is unread.
 *
 * Wire shape note: the notification POST endpoint on the pod is
 * write-only at the moment (`registerNotificationsRoutes`). Listing
 * isn't part of the canonical Hub Protocol surface yet — the proxy
 * still goes there so that when the pod adds a GET handler this
 * panel just lights up. Until then, the panel will show the pod's
 * 404 inside a benign empty state ("No notifications") rather than
 * a hard error.
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

type NotificationCategory = "info" | "success" | "warning" | "danger";

interface WireNotification {
  id: string;
  type: string;
  title?: string;
  message?: string;
  category?: NotificationCategory;
  status?: "unread" | "read" | "actioned";
  createdAt?: string;
  actionUrl?: string;
  data?: Record<string, unknown>;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; items: WireNotification[] }
  | { kind: "error"; message: string };

export function NotificationsPanel() {
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });

  const fetchAll = useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      const r = await fetch("/api/hub/notifications", {
        credentials: "include",
        cache: "no-store",
      });
      if (r.status === 404) {
        // Pod doesn't expose a list handler yet — render empty rather
        // than a noisy "couldn't load" error.
        setLoad({ kind: "ready", items: [] });
        return;
      }
      if (!r.ok) {
        const txt = await r.text().catch(() => "");
        throw new Error(
          txt && txt.length < 200 ? txt : `Pod returned ${r.status}`,
        );
      }
      const json = (await r.json().catch(() => null)) as
        | { notifications?: WireNotification[] }
        | WireNotification[]
        | null;
      const items: WireNotification[] = Array.isArray(json)
        ? json
        : Array.isArray(json?.notifications)
          ? json.notifications
          : [];
      setLoad({ kind: "ready", items });
    } catch (err) {
      setLoad({
        kind: "error",
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const unreadCount = useMemo(() => {
    if (load.kind !== "ready") return 0;
    return load.items.filter((n) => n.status === "unread").length;
  }, [load]);

  const handleMarkAllRead = useCallback(async () => {
    if (load.kind !== "ready") return;
    const targets = load.items.filter((n) => n.status === "unread");
    if (targets.length === 0) return;
    // Optimistic local flip; the POST is best-effort.
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
      await fetch("/api/hub/notifications", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "notification.mark_all_read",
          ids: targets.map((n) => n.id),
        }),
        cache: "no-store",
      });
    } catch {
      // The local flip already happened; a future fetchAll will reconcile.
      addToast({
        title: "Mark-as-read sync failed",
        color: "warning",
      });
    }
  }, [load]);

  const handleOpen = useCallback(async (n: WireNotification) => {
    if (n.actionUrl) {
      window.open(n.actionUrl, "_blank", "noopener,noreferrer");
    }
    if (n.status !== "unread") return;
    // Best-effort mark-read on click.
    try {
      await fetch("/api/hub/notifications", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "notification.mark_read",
          id: n.id,
        }),
        cache: "no-store",
      });
    } catch {
      /* swallow — visual stays consistent */
    }
  }, []);

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
  const cat: NotificationCategory = n.category ?? "info";
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

function relativeTime(ts: string): string {
  const t = new Date(ts).getTime();
  if (Number.isNaN(t)) return ts;
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
