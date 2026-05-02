"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard, Sparkles, Boxes, Globe, Settings as SettingsIcon, LogOut,
  Stethoscope, MessagesSquare,
} from "lucide-react";
import { useEffect, useState, type ComponentType } from "react";
import { Wordmark } from "../components/wordmark";
import { ThemeToggle } from "../components/theme-toggle";

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

const NAV: NavItem[] = [
  { href: "/dashboard",            label: "Home",         icon: LayoutDashboard },
  { href: "/dashboard/components", label: "Components",   icon: Boxes },
  { href: "/dashboard/channels",   label: "Channels",     icon: MessagesSquare },
  { href: "/dashboard/ai",         label: "AI Providers", icon: Sparkles },
  { href: "/dashboard/networking", label: "Networking",   icon: Globe },
  { href: "/dashboard/doctor",     label: "Doctor",       icon: Stethoscope },
  { href: "/dashboard/settings",   label: "Settings",     icon: SettingsIcon },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
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

  return (
    <div className="flex min-h-screen">
      {/* ----------------------------------------------------------------
       * Rail — sticky to the viewport, never taller than 100vh.
       * Wordmark + nav scroll internally if items overflow; footer pinned.
       * --------------------------------------------------------------- */}
      <aside
        className="hidden lg:flex sticky top-0 h-screen flex-col w-60 shrink-0 border-r border-divider bg-content1/60 backdrop-blur-sm"
      >
        {/* Header — fixed */}
        <div className="px-5 pt-6 pb-4 shrink-0">
          <Wordmark size="md" />
          {hostname && (
            <p className="mt-2 truncate font-mono text-[11px] text-default-400" title={hostname}>
              {hostname}
            </p>
          )}
        </div>

        {/* Nav — scrolls internally if it ever overflows */}
        <nav className="flex-1 min-h-0 overflow-y-auto px-3 mt-2 space-y-0.5">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
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
        </nav>

        {/* Footer — pinned to bottom */}
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

      {/* ----------------------------------------------------------------
       * Mobile top bar (rail collapses below lg)
       * --------------------------------------------------------------- */}
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

      {/* ----------------------------------------------------------------
       * Main content
       * --------------------------------------------------------------- */}
      <main className="flex-1 min-w-0">
        <div className="mx-auto w-full max-w-6xl px-6 py-8 lg:px-10 lg:py-10">
          {/* Mobile sub-nav — pills */}
          <div className="lg:hidden mb-6 -mx-4 px-4 flex gap-1 overflow-x-auto">
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = pathname === href;
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
