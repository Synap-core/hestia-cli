"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { usePathname, useRouter } from "next/navigation";
import { useDockApps } from "../use-dock-apps";
import { OverlayIcon, brandAccentFor } from "./shared";

export function SwitcherOverlay({ onClose }: { onClose: () => void }) {
  const apps = useDockApps();
  const pathname = usePathname();
  const router = useRouter();

  // Start on the next app from current (Cmd+Tab behaviour)
  const currentIndex = apps.findIndex((a) =>
    a.path === "/" ? pathname === "/" : pathname?.startsWith(a.path),
  );
  const [activeIndex, setActiveIndex] = useState(() =>
    (currentIndex + 1) % Math.max(1, apps.length),
  );

  const active = apps[activeIndex];

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") { onClose(); return; }

      const isMod = e.metaKey || e.ctrlKey;

      if (isMod && e.key === "Tab") {
        e.preventDefault();
        if (e.shiftKey) {
          setActiveIndex((i) => (i - 1 + apps.length) % apps.length);
        } else {
          setActiveIndex((i) => (i + 1) % apps.length);
        }
        return;
      }

      if (e.key === "ArrowRight") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % apps.length);
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + apps.length) % apps.length);
      }
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (active) navigate(active.path);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [apps, active, onClose]);

  function navigate(path: string) {
    onClose();
    if (path.startsWith("http")) {
      window.location.href = path;
    } else {
      router.push(path);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center">
      {/* Backdrop */}
      <motion.div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.1 }}
        onClick={onClose}
        aria-hidden
      />

      {/* Switcher strip */}
      <motion.div
        className="relative z-10 flex flex-col items-center gap-4"
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.94 }}
        transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
        role="dialog"
        aria-modal
        aria-label="App switcher"
      >
        {/* Icon row */}
        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-4 shadow-2xl backdrop-blur-2xl">
          {apps.map((app, i) => {
            const isActive = i === activeIndex;
            const isCurrent = i === currentIndex;
            return (
              <button
                key={app.id}
                onClick={() => navigate(app.path)}
                onMouseEnter={() => setActiveIndex(i)}
                aria-label={app.name}
                aria-current={isCurrent ? "page" : undefined}
                className="relative flex flex-col items-center focus:outline-none"
              >
                <span
                  className={`block transition-transform duration-150 ${
                    isActive ? "scale-110" : "scale-100 opacity-70 hover:opacity-90"
                  }`}
                >
                  <OverlayIcon slug={app.slug} iconUrl={app.iconUrl} size="md" />
                </span>

                {/* Active ring */}
                {isActive && (
                  <motion.span
                    layoutId="switcher-ring"
                    className="absolute -inset-1.5 rounded-[18px] border-2"
                    style={{ borderColor: brandAccentFor(app.slug) }}
                    transition={{ duration: 0.15 }}
                    aria-hidden
                  />
                )}

                {/* Current-page dot */}
                {isCurrent && (
                  <span
                    className="absolute -bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-foreground/40"
                    aria-hidden
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Active app name */}
        {active && (
          <motion.p
            key={active.id}
            className="text-[13px] font-medium text-foreground/70"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.1 }}
          >
            {active.name}
          </motion.p>
        )}
      </motion.div>
    </div>
  );
}
