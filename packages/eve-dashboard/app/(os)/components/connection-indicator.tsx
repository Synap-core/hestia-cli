/**
 * `connection-indicator.tsx` — visual health dot for the pod connection.
 *
 * Uses the `useSessionHealth` hook to render:
 *   - 🟢 Green dot    → connected
 *   - 🟡 Amber pulse  → reconnecting / loading
 *   - 🔴 Red dot      → disconnected / stale
 *   - ⚪ Gray dot     → unconfigured (no pod URL)
 *
 * Clicking opens the pod pair dialog.
 */

"use client";

import { useSessionHealth } from "@/lib/use-session-health";
import { Spinner } from "@heroui/react";
import { CheckCircle, Circle, CircleSlash } from "lucide-react";
import { useCallback } from "react";

interface ConnectionIndicatorProps {
  onClick?: () => void;
}

const HEALTH_STYLE: Record<
  import("@/lib/use-session-health").SessionHealth,
  { color: string; icon: React.ElementType; label: string }
> = {
  connected: {
    color: "text-success",
    icon: CheckCircle,
    label: "Connected",
  },
  reconnecting: {
    color: "text-warning",
    icon: Spinner,
    label: "Reconnecting",
  },
  disconnected: {
    color: "text-danger",
    icon: CircleSlash,
    label: "Disconnected",
  },
  unconfigured: {
    color: "text-foreground/40",
    icon: Circle,
    label: "No pod",
  },
};

export function ConnectionIndicator({
  onClick,
}: ConnectionIndicatorProps) {
  const { health, refetch } = useSessionHealth();
  const style = HEALTH_STYLE[health];
  const Icon = style.icon;

  const handleClick = useCallback(() => {
    if (health === "reconnecting") return;
    if (onClick) onClick();
    else refetch();
  }, [health, onClick, refetch]);

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={`Pod connection — ${style.label}`}
      className={`
        inline-flex items-center gap-1.5 rounded-full px-2.5 py-1
        bg-foreground/[0.04] border border-foreground/[0.06]
        transition-colors duration-150
        hover:bg-foreground/[0.06]
        focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40
        ${onClick ? "cursor-pointer" : health === "reconnecting" ? "cursor-wait" : "cursor-default"}
      `}
      disabled={health === "reconnecting"}
    >
      {health === "reconnecting" ? (
        <Spinner size="sm" classNames={{ circle: "text-warning" }} />
      ) : (
        <Icon className={`h-2.5 w-2.5 shrink-0 ${style.color}`} strokeWidth={2.5} />
      )}
      <span className={`text-[11px] font-medium ${style.color}`}>
        {style.label}
      </span>
    </button>
  );
}