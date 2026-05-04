"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard, Sparkles, Boxes, Globe, Settings as SettingsIcon, LogOut,
  Stethoscope, MessagesSquare, Terminal as TermIcon, LayoutGrid, CalendarClock,
} from "lucide-react";
import { useEffect, useState, type ComponentType } from "react";
import { Wordmark } from "./wordmark";
import { ThemeToggle } from "./theme-toggle";

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

interface NavGroup {
  label?: string;
  items: NavItem[];
}

// Top group: primary surfaces (Home, Agents, Intents, Apps).
// Settings group: configuration pages (formerly under /dashboard/*).
const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { href: "/",          label: "Home",    icon: LayoutDashboard },
      { href: "/agents",    label: "Agents",  icon: TermIcon },
      { href: "/intents",   label: "Intents", icon: CalendarClock },
      { href: "/apps",      label: "Apps",    icon: LayoutGrid },
    ],
  },
  {
    label: "Settings",
    items: [
      { href: "/settings",            label: "General",      icon: SettingsIcon },
      { href: "/settings/components", label: "Components",   icon: Boxes },
      { href: "/settings/channels",   label: "Channels",     icon: MessagesSquare },
      { href: "/settings/ai",         label: "AI Providers", icon: Sparkles },
      { href: "/settings/networking", label: "Networking",   icon: Globe },
      { href: "/settings/doctor",     label: "Doctor",       icon: Stethoscope },
    ],
  },
];

// Flat list for the mobile horizontal nav strip (no group headers there).
const NAV: NavItem[] = NAV_GROUPS.flatMap(g => g.items);

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [hostname, setHostname] = useState<string>("");

  useEffect(() => {
    setHostname(window.location.hostname);
  }, []);

  async function signOut() {
    await fetch("/api/auth/signout", { method: "POST", credentials: "include" });
    router.push("/login");
  }

  // Exact-match-only routes are roots that have child routes living under
  // them in the same NAV group (e.g. /settings has /settings/components).
  // For those, we only want the parent active on its exact path, never on a
  // child path — otherwise both the parent and the child would highlight.
  // "/" must be exact-match-only — `startsWith("/")` would match every
  // path and light up the Home item permanently.
  const EXACT_ONLY = new Set<string>(["/", "/settings"]);
  const isActive = (href: string) => {
    if (EXACT_ONLY.has(href)) return pathname === href;
    return pathname === href || (href !== "/" && pathname?.startsWith(href + "/"));
  };

  return (
    <div className="flex min-h-screen">
      <aside className="hidden lg:flex sticky top-0 h-screen flex-col w-60 shrink-0 border-r border-divider bg-content1/60 backdrop-blur-sm">
        <div className="px-5 pt-6 pb-4 shrink-0">
          <Wordmark size="md" />
          {hostname && (
            <p className="mt-2 truncate font-mono text-[11px] text-default-400" title={hostname}>
              {hostname}
            </p>
          )}
        </div>

        <nav className="flex-1 min-h-0 overflow-y-auto px-3 mt-2 space-y-3">
          {NAV_GROUPS.map((group, groupIdx) => (
            <div key={group.label ?? `g${groupIdx}`} className="space-y-0.5">
              {group.label && (
                <p className="px-3 pt-1 pb-1.5 text-[10px] font-medium uppercase tracking-wider text-default-400">
                  {group.label}
                </p>
              )}
              {group.items.map(({ href, label, icon: Icon }) => {
                const active = isActive(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    className={
                      "group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors " +
                      (active
                        ? "bg-content2 text-foreground"
                        : "text-default-500 hover:bg-content2/60 hover:text-foreground")
                    }
                  >
                    {active && (
                      <span
                        className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-primary"
                        aria-hidden
                      />
                    )}
                    <Icon className="h-4 w-4" />
                    <span>{label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="px-3 pb-4 pt-3 border-t border-divider space-y-1 shrink-0">
          <div className="flex items-center justify-between px-3 py-1.5">
            <span className="text-[11px] uppercase tracking-wider text-default-400">Theme</span>
            <ThemeToggle compact />
          </div>
          <button
            type="button"
            onClick={signOut}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-default-500 hover:bg-content2/60 hover:text-foreground transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      <header className="lg:hidden sticky top-0 z-40 flex w-full items-center justify-between border-b border-divider bg-content1/80 px-4 py-3 backdrop-blur-sm">
        <Wordmark size="sm" />
        <div className="flex items-center gap-1">
          <ThemeToggle compact />
          <button
            type="button"
            onClick={signOut}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-default-500 hover:text-foreground hover:bg-content2 transition-colors"
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main className="flex-1 min-w-0">
        <div className="mx-auto w-full max-w-6xl px-6 py-8 lg:px-10 lg:py-10">
          <div className="lg:hidden mb-6 -mx-4 px-4 flex gap-1 overflow-x-auto">
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = isActive(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={
                    "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs whitespace-nowrap transition-colors " +
                    (active
                      ? "bg-primary/15 text-primary"
                      : "text-default-500 hover:bg-content2 hover:text-foreground")
                  }
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </Link>
              );
            })}
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
