"use client";

/**
 * `PaneHeader` — sticky 56px header at the top of the popup pane.
 *
 * Three slots:
 *   • `back` (optional) — back arrow, rendered when the app is one or
 *      more levels deep. Apps own their own routing so they pass a
 *      handler explicitly; the shell does not infer history.
 *   • `title` (optional) — string. The Home explicitly omits this so
 *      the greeting block carries identity instead.
 *   • `actions` (optional) — top-right slot for app-specific buttons
 *      (settings gear, filter, etc.).
 *
 * The header has a subtle bottom border that fades in only when the
 * body content is scrolled (`hasScrolled`). For v1 we just always
 * render the border at low opacity — the polish pass adds the
 * scroll-aware fade.
 *
 * See: synap-team-docs/content/team/platform/eve-os-shell.mdx §4
 */

import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";

export interface PaneHeaderProps {
  title?: string;
  back?: () => void;
  actions?: ReactNode;
}

export function PaneHeader({ title, back, actions }: PaneHeaderProps) {
  return (
    <header
      className="
        flex h-14 shrink-0 items-center justify-between gap-3 px-5
        border-b border-white/[0.04] dark:border-white/[0.04]
      "
    >
      <div className="flex items-center gap-2 min-w-0">
        {back && (
          <button
            type="button"
            onClick={back}
            aria-label="Back"
            className="
              inline-flex h-8 w-8 items-center justify-center rounded-full
              text-default-500 hover:text-foreground hover:bg-white/5
              transition-colors
            "
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
        {title && (
          <h1 className="font-heading text-base font-medium text-foreground truncate">
            {title}
          </h1>
        )}
      </div>
      <div className="flex items-center gap-1.5">{actions}</div>
    </header>
  );
}
