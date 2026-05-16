"use client";

/**
 * `Companion` — a frosted-glass side surface that COEXISTS with the
 * active pane. Replaces the "wall screen" pattern (fullscreen takeover
 * via `createPortal` in `/apps/[id]/page-client.tsx`) for surfaces that
 * are meant to flow *alongside* the operator's work, not replace it.
 *
 * Visual contract:
 *   • Same `.os-pane` frosted-glass surface as `Pane` — identical border,
 *     blur, and outer radius. Concentric-radius rule for the body
 *     (inner = outer - 2px).
 *   • Header mirrors `PaneHeader` (h-14, sticky, light bottom border).
 *   • Body hosts an `AppPane` so the iframe + auth handshake +
 *     overlay-bridge are not reimplemented.
 *   • Width is *not* set here — the parent layout passes it via inline
 *     style (`style.width`) so the open/close animation lives at the
 *     layout level, where flex can rebalance the pane in the same tick.
 *
 * See: companion-store.ts for the open/kind/payload contract.
 */

import { Button } from "@heroui/react";
import { Maximize2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import type { CSSProperties } from "react";
import { useCompanionStore, type CompanionKind, type CompanionPayload } from "../stores/companion-store";
import { AppPane } from "./app-pane";
import { createEmbeddedAppHref } from "../lib/app-launch-url";

const COMPANION_APP_ID: Record<CompanionKind, string> = {
  "ai-chat": "openwebui",
};

const COMPANION_FALLBACK_TITLE: Record<CompanionKind, string> = {
  "ai-chat": "Chat",
};

export interface CompanionProps {
  /** Inline width (px or CSS length). Parent owns the open/close transition. */
  width: string;
}

export function Companion({ width }: CompanionProps) {
  const router = useRouter();
  const open = useCompanionStore((s) => s.open);
  const kind = useCompanionStore((s) => s.kind);
  const payload = useCompanionStore((s) => s.payload);
  const close = useCompanionStore((s) => s.close);

  // Always rendered so the width transition can interpolate from 0,
  // but hidden + non-interactive when closed.
  const isMounted = open && kind && payload;
  const appId = kind ? COMPANION_APP_ID[kind] : null;
  const title = payload?.title ?? (kind ? COMPANION_FALLBACK_TITLE[kind] : "");
  const url = payload?.url ?? "";

  const expandToFullscreen = () => {
    if (!appId || !url) return;
    close();
    router.push(
      createEmbeddedAppHref({ id: appId, name: title, url }),
    );
  };

  const style: CSSProperties = {
    width,
    // Match Pane's outer radius via the pane border-radius theme token.
    // (.os-pane already sets it; we let the class drive radius.)
    transition: "width 280ms cubic-bezier(0.32, 0.72, 0, 1), opacity 200ms ease-out",
    opacity: open ? 1 : 0,
    pointerEvents: open ? "auto" : "none",
  };

  return (
    <aside
      aria-label={title || "Companion"}
      aria-hidden={!open}
      className="
        os-pane
        flex shrink-0 flex-col overflow-hidden
        h-[calc(100vh-6.5rem)] sm:h-[86vh] md:h-[82vh]
        md:min-h-[600px] md:max-h-[880px]
      "
      style={style}
    >
      {isMounted && appId && url ? (
        <>
          <header className="flex h-14 shrink-0 items-center justify-between gap-3 px-4 border-b border-foreground/[0.05]">
            <h2 className="font-heading text-[15px] font-medium text-foreground truncate">
              {title}
            </h2>
            <div className="flex items-center gap-1">
              <Button
                isIconOnly
                variant="light"
                size="sm"
                radius="full"
                aria-label="Expand to fullscreen"
                onPress={expandToFullscreen}
                className="text-foreground/55 hover:text-foreground"
              >
                <Maximize2 className="h-4 w-4" strokeWidth={2} />
              </Button>
              <Button
                isIconOnly
                variant="light"
                size="sm"
                radius="full"
                aria-label="Close companion"
                onPress={close}
                className="text-foreground/55 hover:text-foreground"
              >
                <X className="h-4 w-4" strokeWidth={2} />
              </Button>
            </div>
          </header>
          {/* Concentric-radius: body inner radius = pane outer radius - 2px.
              We let overflow-hidden on the parent clip naturally. */}
          <div className="min-h-0 flex-1">
            <AppPane appId={appId} url={url} sendAuth />
          </div>
        </>
      ) : null}
    </aside>
  );
}
