"use client";

/**
 * `TopBar` — single horizontal row above the OS Home grid.
 *
 * Layout: search (centre) · settings link · user avatar (right).
 * 64px tall, sticky to the top of the home page. Sits inside the
 * AppShell so the sidebar still owns navigation chrome on the left.
 *
 * The avatar is intentionally a plain initial in Phase 2A — the auth
 * layer doesn't expose a user object yet (the JWT just gates access).
 * When user metadata lands, swap the placeholder for a real avatar
 * + dropdown menu.
 */

import Link from "next/link";
import { Settings as SettingsIcon, User as UserIcon } from "lucide-react";
import { SearchBar } from "./search-bar";

export interface TopBarProps {
  onSearch: (query: string) => void;
  /** Optional first letter for the avatar bubble. */
  avatarInitial?: string;
}

export function TopBar({ onSearch, avatarInitial }: TopBarProps) {
  const initial = (avatarInitial ?? "E").trim().slice(0, 1).toUpperCase();

  return (
    <header
      className="
        sticky top-0 z-30 -mx-6 lg:-mx-10 px-6 lg:px-10
        flex h-16 items-center gap-4
        bg-background/85 backdrop-blur-sm
      "
    >
      <div className="flex-1 flex justify-center min-w-0">
        <SearchBar onChange={onSearch} />
      </div>

      <nav className="flex items-center gap-1.5 shrink-0">
        <Link
          href="/settings"
          aria-label="Settings"
          className="
            inline-flex h-9 w-9 items-center justify-center rounded-lg
            text-default-500 hover:text-foreground hover:bg-content2
            transition-colors
          "
        >
          <SettingsIcon className="h-4 w-4" />
        </Link>

        {/* Avatar placeholder — circular, single initial. Real menu
            (profile / sign out / switch pod) lands when the auth layer
            grows a user object. */}
        <button
          type="button"
          aria-label="Account menu"
          title="Account (coming soon)"
          className="
            inline-flex h-9 w-9 items-center justify-center rounded-full
            border border-divider bg-content1
            text-xs font-medium text-foreground
            hover:bg-content2 transition-colors
          "
        >
          {initial || <UserIcon className="h-4 w-4 text-default-500" />}
        </button>
      </nav>
    </header>
  );
}
