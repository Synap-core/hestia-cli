"use client";

/**
 * Shared loader / empty / error states for Inbox panels.
 *
 * Centralised so the three panels (Proposals / Notifications /
 * Activity) render visually identical placeholders — the eye keys off
 * a consistent layout when switching tabs, which makes "empty" read as
 * a calm signal instead of a glitch.
 */

import { Card } from "@heroui/react";
import type { LucideIcon } from "lucide-react";

export function PanelLoader() {
  return (
    <div className="flex flex-1 items-center justify-center py-12">
      <span
        className="
          h-5 w-5 animate-spin rounded-full
          border-2 border-foreground/20 border-t-foreground/55
        "
        role="status"
        aria-label="Loading"
      />
    </div>
  );
}

export function PanelEmpty({
  icon: Icon,
  title,
  hint,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
}) {
  return (
    <Card
      radius="md"
      shadow="none"
      className="
        flex flex-col items-center gap-3 px-6 py-12 text-center
        bg-foreground/[0.04]
        ring-1 ring-inset ring-foreground/10
      "
    >
      <span
        className="
          flex h-10 w-10 items-center justify-center
          rounded-lg
          bg-foreground/[0.05]
          ring-1 ring-inset ring-foreground/10
          text-foreground/55
        "
        aria-hidden
      >
        <Icon className="h-4 w-4" strokeWidth={2} />
      </span>
      <p className="text-[13px] font-medium text-foreground">{title}</p>
      {hint && (
        <p className="max-w-xs text-[12px] leading-snug text-foreground/55">
          {hint}
        </p>
      )}
    </Card>
  );
}

export function PanelError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <Card
      radius="md"
      shadow="none"
      className="
        flex flex-col gap-2 px-5 py-4
        bg-danger/10
        ring-1 ring-inset ring-danger/30
      "
    >
      <p className="text-[13px] font-medium text-danger">
        Couldn’t load this panel
      </p>
      <p className="text-[12px] leading-snug text-foreground/65">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="self-start text-[12px] font-medium text-primary hover:underline"
      >
        Try again
      </button>
    </Card>
  );
}
