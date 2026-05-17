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
 *   • Body renderer switches on `kind`:
 *       - "ai-chat"   → iframe-backed `AppPane` (URL embed + auth handshake).
 *       - "marketplace" → inline `<MarketplaceView compact />` (internal
 *                          Next.js component, no iframe).
 *   • Width is *not* set here — the parent layout passes it via inline
 *     style (`style.width`) so the open/close animation lives at the
 *     layout level, where flex can rebalance the pane in the same tick.
 *
 * See: companion-store.ts for the open/kind/payload contract.
 */

import { Button } from "@heroui/react";
import { ArrowRight, Sparkles, X } from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";
import { useCompanionStore, type CompanionKind } from "../stores/companion-store";

const COMPANION_FALLBACK_TITLE: Record<CompanionKind, string> = {
  "ai-chat": "Chat",
};

export interface CompanionProps {
  /** Inline width (px or CSS length). Parent owns the open/close transition. */
  width: string;
}

export function Companion({ width }: CompanionProps) {
  const open = useCompanionStore((s) => s.open);
  const kind = useCompanionStore((s) => s.kind);
  const payload = useCompanionStore((s) => s.payload);
  const close = useCompanionStore((s) => s.close);

  const isMounted = open && kind && payload;
  const title = payload?.title ?? (kind ? COMPANION_FALLBACK_TITLE[kind] : "");

  const style: CSSProperties = {
    width,
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
      {isMounted ? (
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
                aria-label="Close companion"
                onPress={close}
                className="text-foreground/55 hover:text-foreground"
              >
                <X className="h-4 w-4" strokeWidth={2} />
              </Button>
            </div>
          </header>
          <div className="min-h-0 flex-1 flex flex-col">
            <CompanionBody kind={kind} />
          </div>
        </>
      ) : null}
    </aside>
  );
}

function CompanionBody({ kind }: { kind: CompanionKind }) {
  if (kind === "ai-chat") {
    return <ChatPlaceholder />;
  }
  return null;
}

/**
 * Placeholder for the native Eve AI chat. The previous implementation
 * iframed OpenWebUI, which felt foreign and broke when not installed.
 * The companion shell (slide-in, hotkey, dock indicator) still works —
 * this body is what gets replaced when the native chat lands.
 */
function ChatPlaceholder() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 py-10 text-center">
      <span
        className="flex h-14 w-14 items-center justify-center rounded-2xl bg-foreground/[0.06] ring-1 ring-inset ring-foreground/10"
        aria-hidden
      >
        <Sparkles className="h-6 w-6 text-foreground/55" strokeWidth={1.75} />
      </span>
      <div className="flex flex-col gap-1.5 max-w-[280px]">
        <h3 className="text-[15px] font-medium text-foreground">
          Native chat — coming soon
        </h3>
        <p className="text-[12.5px] leading-relaxed text-foreground/55">
          Eve will host its own AI chat here, talking directly to your pod.
          For now, install a chat app from the marketplace or use Studio.
        </p>
      </div>
      <Link href="/marketplace" onClick={useCompanionStore.getState().close}>
        <Button
          size="sm"
          radius="full"
          variant="flat"
          color="default"
          endContent={<ArrowRight className="h-3.5 w-3.5" />}
          className="text-foreground"
        >
          Browse marketplace
        </Button>
      </Link>
    </div>
  );
}
