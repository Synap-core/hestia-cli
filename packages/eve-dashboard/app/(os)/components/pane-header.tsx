"use client";

/**
 * `PaneHeader` — sticky 56px header at the top of the popup pane.
 *
 * Three slots (provided by each app):
 *   • `back` (optional) — invoked when the operator clicks ⌃ to go back
 *   • `title` (optional) — string. The Home omits this so the greeting
 *      block carries identity instead.
 *   • `actions` (optional) — top-right slot for app-specific buttons.
 *
 * The back affordance uses HeroUI Button (isIconOnly, variant=light)
 * so its hover + focus + disabled states inherit the theme. Same for
 * the actions slot — pass HeroUI components there, not raw <button>s,
 * so contrast and motion are consistent with the rest of the OS.
 *
 * See: synap-team-docs/content/team/platform/eve-os-shell.mdx §4
 */

import { Button } from "@heroui/react";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";

export interface PaneHeaderProps {
  title?: string;
  back?: () => void;
  actions?: ReactNode;
  /**
   * Optional custom content for the left side of the header. When
   * provided, replaces the default `title` rendering — useful for the
   * Home page where we want a richer greeting block (sparkle + date)
   * instead of a plain heading. The `back` button still renders before
   * children when both are set.
   */
  children?: ReactNode;
}

export function PaneHeader({ title, back, actions, children }: PaneHeaderProps) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 px-4 border-b border-foreground/[0.05]">
      <div className="flex items-center gap-2 min-w-0">
        {back && (
          <Button
            isIconOnly
            variant="light"
            size="sm"
            radius="full"
            aria-label="Back"
            onPress={back}
            className="text-foreground/55 hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        )}
        {children ? (
          children
        ) : title ? (
          <h1 className="font-heading text-[15px] font-medium text-foreground truncate">
            {title}
          </h1>
        ) : null}
      </div>
      <div className="flex items-center gap-1">{actions}</div>
    </header>
  );
}
