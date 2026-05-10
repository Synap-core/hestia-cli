"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { usePinContext } from "../pin-context";

interface CommandItem {
  id: string;
  name: string;
  hint?: string;
  emoji?: string;
  iconUrl?: string | null;
  href: string;
}

const CORE_ITEMS: CommandItem[] = [
  { id: "home",        name: "Home",        hint: "Eve home",      emoji: "🏠", href: "/" },
  { id: "agents",      name: "Agents",      hint: "Your agents",   emoji: "🤖", href: "/agents" },
  { id: "inbox",       name: "Inbox",       hint: "Proposals",     emoji: "📥", href: "/inbox" },
  { id: "pulse",       name: "Pulse",       hint: "System health", emoji: "💓", href: "/pulse" },
  { id: "marketplace", name: "Marketplace", hint: "Browse apps",   emoji: "🛍️", href: "/marketplace" },
  { id: "settings",    name: "Settings",    hint: "Eve settings",  emoji: "⚙️", href: "/settings" },
];

export function CommandOverlay({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { pinnedApps } = usePinContext();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const allItems: CommandItem[] = [
    ...CORE_ITEMS,
    ...pinnedApps.map((a) => ({
      id: a.id,
      name: a.name,
      iconUrl: a.iconUrl,
      hint: "Pinned",
      href: a.url,
    })),
  ];

  const items = query.trim()
    ? allItems.filter(
        (item) =>
          item.name.toLowerCase().includes(query.toLowerCase()) ||
          item.hint?.toLowerCase().includes(query.toLowerCase()),
      )
    : allItems;

  useEffect(() => { setActiveIndex(0); }, [query]);

  useEffect(() => {
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, []);

  const select = useCallback(
    (item: CommandItem) => {
      onClose();
      if (item.href.startsWith("http")) {
        window.location.href = item.href;
      } else {
        router.push(item.href);
      }
    },
    [onClose, router],
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, items.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      }
      if (e.key === "Enter" && items[activeIndex]) {
        e.preventDefault();
        select(items[activeIndex]);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [items, activeIndex, onClose, select]);

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center pt-[15vh]">
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
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Go to…"
            className="flex-1 bg-transparent text-[14px] text-foreground placeholder:text-foreground/35 outline-none"
            autoComplete="off"
            spellCheck={false}
            aria-label="Command search"
          />
          <kbd className="hidden text-[11px] text-foreground/30 sm:block">esc</kbd>
        </div>

        {/* Results */}
        <div className="max-h-[320px] overflow-y-auto py-1.5" role="listbox" aria-label="Results">
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-foreground/40">
              No results for &ldquo;{query}&rdquo;
            </p>
          ) : (
            items.map((item, i) => (
              <button
                key={item.id}
                role="option"
                aria-selected={i === activeIndex}
                onClick={() => select(item)}
                onMouseEnter={() => setActiveIndex(i)}
                className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                  i === activeIndex ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"
                }`}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] bg-white/[0.07] text-[15px]">
                  {item.iconUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.iconUrl}
                      alt=""
                      className="h-5 w-5 rounded-[6px] object-cover"
                    />
                  ) : (
                    item.emoji ?? item.name[0]
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium text-foreground/90">
                    {item.name}
                  </p>
                  {item.hint && (
                    <p className="truncate text-[12px] text-foreground/45">{item.hint}</p>
                  )}
                </div>
                {i === activeIndex && (
                  <kbd className="shrink-0 text-[11px] text-foreground/30">↵</kbd>
                )}
              </button>
            ))
          )}
        </div>
      </motion.div>
    </div>
  );
}
