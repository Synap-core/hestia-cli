"use client";

/**
 * `SettingsTabs` — horizontal tab strip + pane header for the Settings app.
 *
 * Replaces the legacy sidebar. Tabs are flat (no nesting); deeper
 * pages (e.g. /settings/components/[id]) keep the parent tab active.
 *
 * The Stack Pulse tab carries the contents of the legacy `/dashboard`
 * page — recontextualized as one of Settings' lenses.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Settings as SettingsIcon, Boxes, MessagesSquare, Sparkles, Globe,
  Stethoscope, Activity, Terminal, CalendarClock, LayoutGrid,
} from "lucide-react";
import type { ComponentType } from "react";
import { PaneHeader } from "../components/pane-header";

interface Tab {
  href: string;
  label: string;
  Icon: ComponentType<{ className?: string }>;
}

const TABS: Tab[] = [
  { href: "/settings",              label: "General",      Icon: SettingsIcon },
  { href: "/settings/stack-pulse",  label: "Stack pulse",  Icon: Activity },
  { href: "/settings/components",   label: "Components",   Icon: Boxes },
  { href: "/settings/agents",       label: "Agents",       Icon: Terminal },
  { href: "/settings/intents",      label: "Intents",      Icon: CalendarClock },
  { href: "/settings/apps",         label: "Apps",         Icon: LayoutGrid },
  { href: "/settings/channels",     label: "Channels",     Icon: MessagesSquare },
  { href: "/settings/ai",           label: "AI",           Icon: Sparkles },
  { href: "/settings/networking",   label: "Networking",   Icon: Globe },
  { href: "/settings/doctor",       label: "Doctor",       Icon: Stethoscope },
];

const EXACT_ONLY = new Set<string>(["/settings"]);

function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (EXACT_ONLY.has(href)) return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}

export function SettingsTabs() {
  const pathname = usePathname();

  return (
    <>
      <PaneHeader title="Settings" />
      <nav
        aria-label="Settings sections"
        className="
          shrink-0 overflow-x-auto border-b border-white/[0.04]
          px-4 py-2
        "
      >
        <div className="flex gap-1 min-w-max">
          {TABS.map(({ href, label, Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                className={
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 " +
                  "text-xs whitespace-nowrap transition-colors " +
                  (active
                    ? "bg-white/10 text-foreground"
                    : "text-default-500 hover:bg-white/5 hover:text-foreground")
                }
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
