"use client";

/**
 * `AgentPicker` — small composer chip + popover for switching the
 * active agent on Eve's chat companion.
 *
 * The chip shows either the user-picked agent name, the channel's
 * default agent name (resolved from `assigned_agent_id`), or a generic
 * "Default" fallback when neither is known. Click → fetches
 * `agents.workspaceList` once (lazy), then opens a popover anchored
 * above the chip. Rows are grouped by `ownerType` ("system" → "provider"
 * → "user"). Selecting a row calls `onChange(slug)`; the first row
 * always resets to the channel default via `onChange(null)`.
 *
 * Design notes:
 *   • Concentric radius: outer 14px → row 12px (matches `dock-pin-popover.tsx`).
 *   • No shadows. Subtle border + backdrop-blur per design system.
 *   • Chip max-width 140px, height 24px — fits inside the composer
 *     without crowding the textarea.
 *   • Per-agent gradient avatar from `brand-colors.ts` when the slug
 *     matches a known brand, else a hue-rotated fallback.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Check, ChevronDown } from "lucide-react";
import { brandColorFor } from "../../lib/brand-colors";
import type { PodAgent } from "../../lib/chat/types";

interface TrpcEnvelope<T> {
  result?: { data?: T | { json?: T } };
  error?: { message?: string };
}

function unwrapTrpc<T>(env: TrpcEnvelope<T> | null): T | null {
  if (!env?.result?.data) return null;
  const data = env.result.data;
  if (data && typeof data === "object" && "json" in (data as object)) {
    return (data as { json?: T }).json ?? null;
  }
  return (data as T) ?? null;
}

async function fetchAgents(workspaceId: string): Promise<PodAgent[]> {
  const enc = encodeURIComponent(JSON.stringify({ json: {} }));
  const r = await fetch(`/api/pod/trpc/agents.workspaceList?input=${enc}`, {
    credentials: "include",
    cache: "no-store",
    headers: { "x-workspace-id": workspaceId },
  });
  if (!r.ok) throw new Error(`Pod returned ${r.status}`);
  const env = (await r.json().catch(() => null)) as TrpcEnvelope<
    PodAgent[]
  > | null;
  if (env?.error?.message) throw new Error(env.error.message);
  return unwrapTrpc(env) ?? [];
}

export interface AgentPickerProps {
  workspaceId: string | null;
  selectedSlug: string | null;
  /** Channel's `assigned_agent_id` — used to resolve the default name. */
  channelAgentId: string | null;
  onChange: (slug: string | null) => void;
}

const OWNER_ORDER: PodAgent["ownerType"][] = ["system", "provider", "user"];
const OWNER_LABEL: Record<PodAgent["ownerType"], string> = {
  system: "System",
  provider: "Providers",
  user: "Custom",
};

export function AgentPicker({
  workspaceId,
  selectedSlug,
  channelAgentId,
  onChange,
}: AgentPickerProps) {
  const [open, setOpen] = useState(false);
  const [agents, setAgents] = useState<PodAgent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Lazy fetch on first open.
  useEffect(() => {
    if (!open || hasLoaded || !workspaceId) return;
    setHasLoaded(true);
    let cancelled = false;
    setIsLoading(true);
    fetchAgents(workspaceId)
      .then((rows) => {
        if (cancelled) return;
        setAgents(rows);
      })
      .catch(() => {
        if (cancelled) return;
        setAgents([]);
      })
      .finally(() => {
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, hasLoaded, workspaceId]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onClick(e: MouseEvent) {
      const root = wrapRef.current;
      if (root && e.target instanceof Node && !root.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  // ─── Display label resolution ────────────────────────────────────────
  // 1. User-picked slug → look up agent name (or fall back to slug).
  // 2. Channel default → look up by channelAgentId.
  // 3. Fallback → "Default".
  const selectedAgent = selectedSlug
    ? agents.find((a) => a.slug === selectedSlug) ?? null
    : null;
  const channelDefaultAgent = channelAgentId
    ? agents.find((a) => a.id === channelAgentId) ?? null
    : null;

  const chipLabel = selectedAgent
    ? selectedAgent.name
    : channelDefaultAgent
      ? channelDefaultAgent.name
      : "Default";
  const chipSlug = selectedAgent?.slug ?? channelDefaultAgent?.slug ?? "orchestrator";

  const grouped = useMemo(() => {
    const buckets: Record<PodAgent["ownerType"], PodAgent[]> = {
      system: [],
      provider: [],
      user: [],
    };
    for (const a of agents) {
      if (a.active === false) continue;
      const k = (buckets[a.ownerType] ? a.ownerType : "system") as PodAgent["ownerType"];
      buckets[k].push(a);
    }
    return buckets;
  }, [agents]);

  const handlePick = useCallback(
    (slug: string | null) => {
      onChange(slug);
      setOpen(false);
    },
    [onChange],
  );

  const palette = brandColorFor(chipSlug);

  return (
    <div ref={wrapRef} className="relative inline-flex">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((p) => !p)}
        className="
          group inline-flex max-w-[140px] items-center gap-1.5
          h-6 px-1.5 rounded-full
          bg-foreground/[0.04] hover:bg-foreground/[0.07]
          ring-1 ring-inset ring-foreground/10
          text-[11.5px] font-medium text-foreground/75 hover:text-foreground
          transition-colors duration-100
          focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40
        "
      >
        <span
          className="h-3.5 w-3.5 shrink-0 rounded-full"
          style={{ background: palette.bg }}
          aria-hidden
        />
        <span className="truncate">{chipLabel}</span>
        <ChevronDown
          className="h-3 w-3 shrink-0 text-foreground/45 group-hover:text-foreground/65"
          strokeWidth={2}
          aria-hidden
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Pick agent"
          className="
            absolute bottom-full left-0 mb-1.5 z-50
            flex w-[260px] max-h-[340px] flex-col overflow-hidden
            rounded-[14px] border border-foreground/10
            bg-background/90 backdrop-blur-2xl
            animate-[dock-pin-pop_140ms_ease-out]
          "
        >
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {/* Default-for-this-channel row, always present. */}
            <AgentRow
              label="Default for this channel"
              subtitle={
                channelDefaultAgent
                  ? channelDefaultAgent.name
                  : "Channel's assigned agent"
              }
              slug={channelDefaultAgent?.slug ?? "orchestrator"}
              selected={selectedSlug === null}
              onPick={() => handlePick(null)}
            />

            {isLoading && (
              <p className="px-2 py-3 text-center text-[12px] text-foreground/55">
                Loading agents…
              </p>
            )}

            {!isLoading && agents.length === 0 && (
              <p className="px-2 py-3 text-center text-[12px] text-foreground/55">
                No agents available
              </p>
            )}

            {!isLoading &&
              OWNER_ORDER.map((owner) => {
                const list = grouped[owner];
                if (list.length === 0) return null;
                return (
                  <div key={owner} className="mt-1">
                    <p className="px-2 pb-1 pt-1.5 text-[10.5px] font-medium uppercase tracking-wide text-foreground/40">
                      {OWNER_LABEL[owner]}
                    </p>
                    <ul className="flex flex-col gap-0.5" role="list">
                      {list.map((agent) => (
                        <AgentRow
                          key={agent.id}
                          label={agent.name}
                          subtitle={agent.slug}
                          slug={agent.slug}
                          selected={selectedSlug === agent.slug}
                          onPick={() => handlePick(agent.slug)}
                        />
                      ))}
                    </ul>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}

interface AgentRowProps {
  label: string;
  subtitle: string;
  slug: string;
  selected: boolean;
  onPick: () => void;
}

function AgentRow({ label, subtitle, slug, selected, onPick }: AgentRowProps) {
  const palette = brandColorFor(slug);
  return (
    <li>
      <button
        type="button"
        role="option"
        aria-selected={selected}
        onClick={onPick}
        className="
          flex w-full items-center gap-2.5 px-2 py-1.5
          rounded-[12px]
          text-left
          transition-colors duration-100
          hover:bg-foreground/[0.06]
          focus:outline-none focus-visible:bg-foreground/[0.06]
        "
      >
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ring-white/15"
          style={{ background: palette.bg }}
          aria-hidden
        >
          <Bot className="h-3.5 w-3.5 text-white" strokeWidth={2} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium leading-tight text-foreground">
            {label}
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-foreground/55">
            {subtitle}
          </span>
        </span>
        <span
          className={
            "flex h-4 w-4 shrink-0 items-center justify-center rounded-full " +
            (selected ? "bg-primary/15 text-primary" : "text-transparent")
          }
          aria-hidden
        >
          {selected && <Check className="h-3 w-3" strokeWidth={2.4} />}
        </span>
      </button>
    </li>
  );
}
