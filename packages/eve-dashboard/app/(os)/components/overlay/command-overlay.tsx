"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { Search, Clock } from "lucide-react";
import { usePinContext } from "../pin-context";
import { useHomeApps } from "../../hooks/use-home-apps";
import { OverlayIcon } from "./shared";

// ─── Recents ──────────────────────────────────────────────────────────────────

const RECENTS_KEY = "eve.command.recents";
const MAX_RECENTS = 5;

interface RecentEntry { id: string; name: string; slug: string; href: string }

function loadRecents(): RecentEntry[] {
  try { return JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]"); }
  catch { return []; }
}

function saveRecent(e: RecentEntry) {
  const prev = loadRecents().filter((r) => r.id !== e.id);
  localStorage.setItem(RECENTS_KEY, JSON.stringify([e, ...prev].slice(0, MAX_RECENTS)));
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Section = "recent" | "core" | "pinned" | "local" | "synap";

const SECTION_LABEL: Record<Section, string> = {
  recent: "Recent",
  core:   "Core",
  pinned: "Pinned",
  local:  "On your Eve",
  synap:  "Synap apps",
};

interface CommandItem {
  id: string;
  name: string;
  hint?: string;
  slug: string;
  iconUrl?: string | null;
  href: string;
  section: Section;
}

// ─── Core items (always instant, no fetch) ────────────────────────────────────

const CORE_ITEMS: CommandItem[] = [
  { id: "home",        name: "Home",        hint: "Eve home",      slug: "home",        href: "/" },
  { id: "agents",      name: "Agents",      hint: "Your agents",   slug: "agents",      href: "/agents" },
  { id: "inbox",       name: "Inbox",       hint: "Proposals",     slug: "inbox",       href: "/inbox" },
  { id: "pulse",       name: "Pulse",       hint: "System health", slug: "pulse",       href: "/pulse" },
  { id: "marketplace", name: "Marketplace", hint: "Browse apps",   slug: "marketplace", href: "/marketplace" },
  { id: "settings",    name: "Settings",    hint: "Eve settings",  slug: "settings",    href: "/settings" },
].map((i) => ({ ...i, section: "core" as const }));

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ label }: { label: string }) {
  return (
    <p className="px-3 pb-1 pt-2.5 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-foreground/35 first:pt-1.5">
      {label}
    </p>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CommandOverlay({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { pinnedApps } = usePinContext();
  const { apps: homeApps, isLoading } = useHomeApps();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [recents, setRecents] = useState<RecentEntry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setRecents(loadRecents()); }, []);

  // Build the full flat item list grouped by section
  const allItems = useMemo<CommandItem[]>(() => {
    const pinnedIds = new Set(pinnedApps.map((a) => a.id));

    const recentItems: CommandItem[] = recents.map((r) => ({
      id:      `recent:${r.id}`,
      name:    r.name,
      hint:    "Recent",
      slug:    r.slug,
      href:    r.href,
      section: "recent",
    }));

    const pinnedItems: CommandItem[] = pinnedApps.map((a) => ({
      id:      a.id,
      name:    a.name,
      slug:    a.slug,
      iconUrl: a.iconUrl,
      hint:    "Pinned",
      href:    a.url,
      section: "pinned",
    }));

    const localItems: CommandItem[] = homeApps
      .filter((a) => a.isLocal && !pinnedIds.has(a.id))
      .map((a) => ({
        id:      a.id,
        name:    a.name,
        hint:    a.description ?? "On your Eve",
        slug:    a.id,
        iconUrl: a.iconUrl,
        href:    a.url,
        section: "local",
      }));

    const synapItems: CommandItem[] = homeApps
      .filter((a) => !a.isLocal && !pinnedIds.has(a.id))
      .map((a) => ({
        id:      a.id,
        name:    a.name,
        hint:    a.description ?? "Synap app",
        slug:    a.id,
        iconUrl: a.iconUrl,
        href:    a.url,
        section: "synap",
      }));

    return [...recentItems, ...CORE_ITEMS, ...pinnedItems, ...localItems, ...synapItems];
  }, [recents, pinnedApps, homeApps]);

  // Filter by query
  const items = useMemo<CommandItem[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allItems;
    return allItems.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.hint?.toLowerCase().includes(q),
    );
  }, [allItems, query]);

  // Clamp active index when list changes
  useEffect(() => {
    setActiveIndex((i) => Math.min(i, Math.max(0, items.length - 1)));
  }, [items.length]);

  // Auto-focus input
  useEffect(() => {
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, []);

  const select = useCallback(
    (item: CommandItem) => {
      const cleanId = item.id.replace(/^recent:/, "");
      saveRecent({ id: cleanId, name: item.name, slug: item.slug, href: item.href });
      setRecents(loadRecents());
      onClose();
      if (item.href.startsWith("http")) {
        window.location.href = item.href;
      } else {
        router.push(item.href);
      }
    },
    [onClose, router],
  );

  // Keyboard handler
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % Math.max(1, items.length));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + Math.max(1, items.length)) % Math.max(1, items.length));
      }
      if (e.key === "Enter" && items[activeIndex]) {
        e.preventDefault();
        select(items[activeIndex]);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [items, activeIndex, onClose, select]);

  // Group items by section for rendering headers
  const grouped = useMemo(() => {
    const groups: { section: Section; items: (CommandItem & { flatIndex: number })[] }[] = [];
    let flatIndex = 0;
    for (const item of items) {
      const last = groups[groups.length - 1];
      if (!last || last.section !== item.section) {
        groups.push({ section: item.section, items: [] });
      }
      groups[groups.length - 1].items.push({ ...item, flatIndex: flatIndex++ });
    }
    return groups;
  }, [items]);

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center pt-[13vh]">
      {/* Backdrop */}
      <motion.div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.12 }}
        onClick={onClose}
        aria-hidden
      />

      {/* Panel */}
      <motion.div
        className="relative z-10 mx-4 w-full max-w-[560px] overflow-hidden rounded-2xl border border-white/10 bg-white/[0.06] shadow-2xl backdrop-blur-2xl"
        initial={{ opacity: 0, scale: 0.97, y: -6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: -6 }}
        transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
        role="dialog"
        aria-modal
        aria-label="Command palette"
      >
        {/* Search row */}
        <div className="flex items-center gap-3 border-b border-white/[0.08] px-4 py-3.5">
          <Search className="h-4 w-4 shrink-0 text-foreground/50" strokeWidth={2} aria-hidden />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); }}
            placeholder="Go to…"
            className="flex-1 bg-transparent text-[14px] text-foreground placeholder:text-foreground/35 outline-none"
            autoComplete="off"
            spellCheck={false}
            aria-label="Command search"
            aria-controls="command-results"
          />
          {isLoading && (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-foreground/20 border-t-foreground/50" />
          )}
          <kbd className="hidden text-[11px] text-foreground/30 sm:block">esc</kbd>
        </div>

        {/* Results */}
        <div
          id="command-results"
          className="max-h-[360px] overflow-y-auto py-1"
          role="listbox"
          aria-label="Results"
        >
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-foreground/40">
              No results for &ldquo;{query}&rdquo;
            </p>
          ) : (
            grouped.map(({ section, items: sectionItems }) => (
              <div key={section} role="group" aria-label={SECTION_LABEL[section]}>
                <SectionHeader label={SECTION_LABEL[section]} />
                {sectionItems.map((item) => {
                  const isActive = item.flatIndex === activeIndex;
                  return (
                    <button
                      key={item.id}
                      role="option"
                      aria-selected={isActive}
                      onClick={() => select(item)}
                      onMouseEnter={() => setActiveIndex(item.flatIndex)}
                      className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
                        isActive ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"
                      }`}
                    >
                      {section === "recent" ? (
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] bg-white/[0.06]">
                          <Clock className="h-3.5 w-3.5 text-foreground/50" strokeWidth={2} />
                        </span>
                      ) : (
                        <OverlayIcon slug={item.slug} iconUrl={item.iconUrl} size="sm" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-foreground/90">
                          {item.name}
                        </p>
                        {item.hint && item.hint !== "Recent" && (
                          <p className="truncate text-[11.5px] text-foreground/40">{item.hint}</p>
                        )}
                      </div>
                      {isActive && (
                        <kbd className="shrink-0 text-[11px] text-foreground/30">↵</kbd>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </motion.div>
    </div>
  );
}
