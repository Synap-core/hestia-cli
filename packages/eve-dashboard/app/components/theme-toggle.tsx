"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun, Monitor } from "lucide-react";

/**
 * Three-state theme toggle (system → light → dark → system).
 * SSR-safe: renders a placeholder until mounted to avoid hydration mismatch.
 */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <span className="block h-8 w-8" aria-hidden />;
  }

  const cycle = () => {
    if (theme === "system") setTheme("light");
    else if (theme === "light") setTheme("dark");
    else setTheme("system");
  };

  const Icon = theme === "system" ? Monitor : resolvedTheme === "dark" ? Moon : Sun;
  const label =
    theme === "system" ? "System theme" : resolvedTheme === "dark" ? "Dark theme" : "Light theme";

  if (compact) {
    return (
      <button
        type="button"
        onClick={cycle}
        aria-label={`Switch theme — currently ${label}`}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-default-500 hover:text-foreground hover:bg-content2 transition-colors"
      >
        <Icon className="h-4 w-4" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={`Switch theme — currently ${label}`}
      className="inline-flex items-center gap-2 rounded-lg border border-divider bg-content1 px-2.5 py-1.5 text-xs text-default-600 hover:bg-content2 transition-colors"
    >
      <Icon className="h-3.5 w-3.5" />
      <span>{label.replace(" theme", "")}</span>
    </button>
  );
}
