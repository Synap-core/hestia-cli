"use client";

/**
 * `SettingsTabs` — pane header + horizontal HeroUI Tabs for Settings.
 *
 * Replaces the legacy AppShell sidebar. Tabs are flat (no nesting);
 * deeper pages (e.g. /settings/components/[id]) keep the parent tab
 * active.
 *
 * Tabs are rendered with HeroUI's `Tabs` (variant=underlined) so the
 * cursor, hover, and selected-state colors all flow from theme tokens.
 * Selecting a tab pushes a route — the page below renders the content
 * for that route normally.
 *
 * See: synap-team-docs/content/team/platform/eve-os-shell.mdx §6
 */

import { Tabs, Tab } from "@heroui/react";
import { useRouter, usePathname } from "next/navigation";
import {
  UserCircle, Boxes, Sparkles, Globe, Stethoscope, Users, MessageSquare,
  Brain,
  type LucideIcon,
} from "lucide-react";
import { PaneHeader } from "../components/pane-header";

interface TabDef {
  href: string;
  label: string;
  Icon: LucideIcon;
}

// Settings owns ONLY host-machine concerns. Everything that has a
// dedicated top-level app (Agents, Marketplace, Pulse, Channels-via-
// Agents) was lifted out of here on 2026-05-05. The remaining axis:
//   Account           — who's signed in, dashboard secret rotation
//   System            — AI, Components, Networking, Doctor
// HeroUI's flat <Tabs> doesn't render group headers, so we rely on
// ordering: Account first, then the four System tabs.
const TABS: TabDef[] = [
  { href: "/settings",                  label: "Account",      Icon: UserCircle },
  { href: "/settings/ai",               label: "AI",           Icon: Sparkles },
  { href: "/settings/intelligence",     label: "Intelligence", Icon: Brain },
  { href: "/settings/channels",         label: "Channels",     Icon: MessageSquare },
  { href: "/settings/components",       label: "Components",   Icon: Boxes },
  { href: "/settings/networking",       label: "Networking",   Icon: Globe },
  { href: "/settings/members",          label: "Members",      Icon: Users },
  { href: "/settings/doctor",           label: "Doctor",       Icon: Stethoscope },
];

const EXACT_ONLY = new Set<string>(["/settings"]);

function activeKey(pathname: string | null): string {
  if (!pathname) return "/settings";
  // Exact match first.
  if (EXACT_ONLY.has(pathname)) return pathname;
  // Longest prefix wins (so /settings/components/[id] activates Components).
  let best = "/settings";
  let bestLen = -1;
  for (const t of TABS) {
    if (EXACT_ONLY.has(t.href)) continue;
    if (pathname === t.href || pathname.startsWith(t.href + "/")) {
      if (t.href.length > bestLen) { best = t.href; bestLen = t.href.length; }
    }
  }
  return best;
}

export function SettingsTabs() {
  const router = useRouter();
  const pathname = usePathname();
  const selected = activeKey(pathname);

  return (
    <>
      <PaneHeader title="Settings" />
      <div className="shrink-0 px-4 pt-1">
        <Tabs
          aria-label="Settings sections"
          variant="underlined"
          color="primary"
          selectedKey={selected}
          onSelectionChange={key => router.push(String(key))}
          classNames={{
            base: "w-full",
            tabList:
              "gap-1 w-full overflow-x-auto p-0 border-b border-foreground/[0.06]",
            cursor: "w-full bg-primary",
            tab: "max-w-fit px-3 h-10",
            tabContent:
              "text-foreground/55 group-data-[selected=true]:text-foreground",
          }}
        >
          {TABS.map(({ href, label, Icon }) => (
            <Tab
              key={href}
              title={
                <span className="inline-flex items-center gap-1.5 text-[12.5px]">
                  <Icon className="h-3.5 w-3.5" strokeWidth={2} />
                  {label}
                </span>
              }
            />
          ))}
        </Tabs>
      </div>
    </>
  );
}
