"use client";

/**
 * `HomeHeaderContent` — composes the OS Home pane header in a single
 * row: greeting (left), stats + sign-in/settings (right).
 *
 * Replaces the previous two-row arrangement where the greeting + stats
 * sat in the body and only the Settings icon was in the header. By
 * collapsing everything into the header strip we save ~140px of
 * vertical space in the body — the apps grid starts immediately.
 *
 *   [✦ Good afternoon · Tuesday May 5]   [agents 0 · today 0 · updates 0]   [Sign in]  [⚙]
 *
 * The stats pills, sign-in CTA, and settings icon are passed in as the
 * caller pleases (via the same `actions` slot of `PaneHeader`). This
 * component just owns the LEFT half (greeting) and a compact stat pill
 * row that the page composes alongside the auth + settings buttons.
 *
 * See: synap-team-docs/content/team/platform/eve-os-home-design.mdx §3
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  addToast,
} from "@heroui/react";
import {
  Circle,
  ExternalLink,
  LogOut,
  Plug,
  Sparkles,
  User,
} from "lucide-react";
import { useStats } from "../hooks/use-stats";
import { useMemberCount } from "../hooks/use-member-count";
import { usePodPairing, type PairingState } from "../hooks/use-pod-pairing";
import {
  getSharedSession,
  isSelfHostedSession,
  signOutOfControlPlane,
} from "@/lib/synap-auth";

// ─── Greeting (header-left) ──────────────────────────────────────────────────

export interface HomeGreetingProps {
  firstName?: string | null;
}

function partOfDay(now: Date): "morning" | "afternoon" | "evening" {
  const h = now.getHours();
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 18) return "afternoon";
  return "evening";
}

const DATE_FMT = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});

export function HomeGreeting({ firstName }: HomeGreetingProps) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const i = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(i);
  }, []);

  const part = now ? partOfDay(now) : "evening";
  const dateLabel = now ? DATE_FMT.format(now) : "";
  const tail = firstName ? `, ${firstName}` : "";

  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <Sparkles
        className="h-4 w-4 shrink-0 text-primary"
        aria-hidden
        strokeWidth={1.8}
      />
      <div className="min-w-0 flex items-baseline gap-2">
        <h1
          className="
            font-heading font-light leading-none tracking-tight truncate
            text-[15px] text-foreground
          "
        >
          Good {part}{tail}
        </h1>
        <span
          className="hidden sm:inline text-[11.5px] text-foreground/55 tabular-nums shrink-0"
          aria-label={`Today is ${dateLabel}`}
        >
          {dateLabel}
        </span>
      </div>
    </div>
  );
}

// ─── Stat pills (header-right cluster) ───────────────────────────────────────

const ACCENT = {
  agents: "#34D399",
  events: "#A78BFA",
  inbox: "#60A5FA",
  members: "#94A3B8",
} as const;

export interface HomeStatPillsProps {
  /**
   * When the pod isn't paired we replace the 3 stat pills with a single
   * "Pair your pod" CTA pill. The home page passes a click handler that
   * opens the `PodPairDialog`. When omitted the cluster always renders
   * the stats (existing behavior preserved for any caller that doesn't
   * want pairing-aware UI).
   */
  onPairPod?: () => void;
  /**
   * Optional override — when supplied, takes precedence over the
   * internal `usePodPairing()` call. Useful for tests / Storybook and
   * for the home page when pairing state is lifted up to coordinate
   * with the pair dialog.
   */
  pairingState?: PairingState;
}

export function HomeStatPills({
  onPairPod,
  pairingState,
}: HomeStatPillsProps = {}) {
  const internalPairing = usePodPairing();
  const effectiveState = pairingState ?? internalPairing.state;

  const isUnpaired =
    effectiveState === "unpaired" ||
    effectiveState === "unconfigured" ||
    effectiveState === "stale-cred";

  // Single CTA pill when unpaired — replaces the 3 stat pills with the
  // most important action the operator can take. Same outer chrome
  // (rounded-full, bg-foreground/[0.04]) so the cluster's silhouette
  // doesn't shift between states.
  if (isUnpaired && onPairPod) {
    return (
      <div
        className="
          hidden md:flex items-center
          rounded-full
          bg-foreground/[0.04] border border-foreground/[0.06]
        "
        aria-label="Pair pod"
      >
        <button
          type="button"
          onClick={onPairPod}
          className="
            group flex items-center gap-1.5 rounded-full px-3 py-1
            transition-colors duration-150
            hover:bg-foreground/[0.06]
            focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40
          "
        >
          <Plug
            className="h-3 w-3 shrink-0 text-primary"
            strokeWidth={2}
            aria-hidden
          />
          <span className="text-[12px] font-medium text-foreground">
            Pair your pod
          </span>
        </button>
      </div>
    );
  }

  return <StatPillsCluster />;
}

function StatPillsCluster() {
  const { stats, isLoading } = useStats();
  const { count: memberCount, isLoading: membersLoading } = useMemberCount();
  return (
    <div
      className="
        hidden md:flex items-center gap-1
        rounded-full px-1 py-0.5
        bg-foreground/[0.04] border border-foreground/[0.06]
      "
      aria-label="Workspace stats"
    >
      <StatPill
        label="agents"
        value={stats.agentsRunning}
        accent={ACCENT.agents}
        href="/agents"
        isLoading={isLoading}
      />
      <span className="h-3 w-px bg-foreground/[0.10]" aria-hidden />
      <StatPill
        label="today"
        value={stats.eventsToday}
        accent={ACCENT.events}
        href="/inbox?tab=activity"
        isLoading={isLoading}
      />
      <span className="h-3 w-px bg-foreground/[0.10]" aria-hidden />
      <StatPill
        label="inbox"
        value={stats.inboxPending}
        accent={ACCENT.inbox}
        href="/inbox"
        isLoading={isLoading}
      />
      <span className="h-3 w-px bg-foreground/[0.10]" aria-hidden />
      <StatPill
        label="members"
        value={memberCount}
        accent={ACCENT.members}
        href="/settings/members"
        isLoading={membersLoading}
      />
    </div>
  );
}

interface StatPillProps {
  label: string;
  value: number;
  accent: string;
  href: string;
  isLoading?: boolean;
}

function StatPill({ label, value, accent, href, isLoading }: StatPillProps) {
  return (
    <Link
      href={href}
      aria-label={`${label}: ${value}`}
      className="
        group flex items-center gap-1.5 rounded-full px-2 py-0.5
        transition-colors duration-150
        hover:bg-foreground/[0.06]
        focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40
      "
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: accent }}
        aria-hidden
      />
      {isLoading ? (
        <span
          className="block h-3 w-4 rounded-sm bg-foreground/10 animate-pulse"
          aria-hidden
        />
      ) : (
        <span className="text-[12px] font-medium tabular-nums text-foreground">
          {value}
        </span>
      )}
      <span className="text-[11px] uppercase tracking-[0.04em] text-foreground/55 group-hover:text-foreground/80 transition-colors">
        {label}
      </span>
    </Link>
  );
}

// ─── Pod status chip (header-right) ──────────────────────────────────────────
//
// Single-glance health of the local pod. Click opens the pair dialog
// — same affordance as the "Pair your pod" CTA pill, but always
// visible (even when paired) so the operator can re-pair / switch
// account from one place.

interface PodStatusChipProps {
  pairingState: PairingState;
  onClick: () => void;
}

const STATUS_TONE: Record<
  PairingState,
  { dot: string; label: string; tone: string }
> = {
  loading: { dot: "#94A3B8", label: "Checking…", tone: "text-foreground/55" },
  unconfigured: {
    dot: "#94A3B8",
    label: "No pod",
    tone: "text-foreground/55",
  },
  unpaired: {
    dot: "#F59E0B",
    label: "Unclaimed",
    tone: "text-warning",
  },
  paired: {
    dot: "#34D399",
    label: "Pod connected",
    tone: "text-success",
  },
  "needs-refresh": {
    dot: "#34D399",
    label: "Pod connected",
    tone: "text-success",
  },
  "stale-cred": {
    dot: "#EF4444",
    label: "Stale",
    tone: "text-danger",
  },
};

export function PodStatusChip({ pairingState, onClick }: PodStatusChipProps) {
  const tone = STATUS_TONE[pairingState];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Pod status — ${tone.label}`}
      className="
        hidden md:inline-flex items-center gap-1.5
        rounded-full px-2.5 py-1
        bg-foreground/[0.04] border border-foreground/[0.06]
        transition-colors duration-150
        hover:bg-foreground/[0.06]
        focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40
      "
    >
      <span
        aria-hidden
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: tone.dot }}
      />
      <span className={`text-[11.5px] font-medium ${tone.tone}`}>
        {tone.label}
      </span>
    </button>
  );
}

// ─── Account avatar + popover ────────────────────────────────────────────────
//
// Right-most cluster element. 32px circle with initials (or image),
// click → popover with name/email/mode + Manage account + Sign out.

export interface AccountAvatarProps {
  /**
   * Optional override for the CP origin used by "Manage account". Falls
   * back to `NEXT_PUBLIC_CP_API_URL` then `https://synap.live`.
   */
  cpAccountUrl?: string;
}

export function AccountAvatar({ cpAccountUrl }: AccountAvatarProps) {
  const [session, setSession] = useState<ReturnType<
    typeof getSharedSession
  > | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    setSession(getSharedSession());
    function onStorage(e: StorageEvent) {
      if (e.key !== "synap:session") return;
      setSession(getSharedSession());
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  if (!session) {
    return null;
  }

  const isSelfHosted = isSelfHostedSession(session);
  const display = session.userName || "—";
  const initials = computeInitials(display);

  // For Manage account — point at the CP web account page.
  const cpUrl =
    cpAccountUrl ||
    process.env.NEXT_PUBLIC_CP_API_URL ||
    process.env.NEXT_PUBLIC_CP_BASE_URL ||
    "https://api.synap.live";
  const accountUrl = cpUrl.replace(/\/+$/, "") + "/account";

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOutOfControlPlane();
      addToast({ title: "Signed out", color: "success" });
      // Force gate to re-evaluate by reloading; storage listener also
      // fires across tabs.
      window.location.reload();
    } catch (err) {
      addToast({
        title: "Couldn't sign out",
        description: err instanceof Error ? err.message : "Unknown error",
        color: "danger",
      });
      setSigningOut(false);
    }
  }

  return (
    <Popover placement="bottom-end" radius="md" offset={6}>
      <PopoverTrigger>
        <button
          type="button"
          aria-label="Account menu"
          className="
            inline-flex h-8 w-8 shrink-0 items-center justify-center
            rounded-full
            bg-foreground/[0.06] ring-1 ring-inset ring-foreground/10
            text-[11px] font-semibold uppercase tracking-tight text-foreground
            transition-colors duration-150
            hover:bg-foreground/[0.10]
            focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40
          "
        >
          {initials || (
            <User className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-0">
        <div className="w-[260px] flex flex-col">
          <div className="flex flex-col gap-1 px-4 pt-3.5 pb-3 border-b border-foreground/[0.06]">
            <div className="flex items-center gap-2">
              <p className="text-[13.5px] font-medium text-foreground truncate">
                {display}
              </p>
              <span
                className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.04em] ${
                  isSelfHosted
                    ? "bg-warning/15 text-warning"
                    : "bg-primary/15 text-primary"
                }`}
              >
                {isSelfHosted ? "Self-hosted" : "Synap"}
              </span>
            </div>
            <p className="text-[11.5px] text-foreground/55 truncate">
              {session.userId
                ? `User ${session.userId.slice(0, 8)}…`
                : isSelfHosted
                  ? "Bound to local pod"
                  : "Synap account"}
            </p>
          </div>

          <div className="py-1">
            {!isSelfHosted && (
              <a
                href={accountUrl}
                target="_blank"
                rel="noreferrer"
                className="
                  flex items-center justify-between gap-2 px-4 py-2
                  text-[12.5px] text-foreground
                  hover:bg-foreground/[0.04]
                "
              >
                <span>Manage account</span>
                <ExternalLink
                  className="h-3 w-3 text-foreground/55"
                  strokeWidth={2}
                  aria-hidden
                />
              </a>
            )}
            <button
              type="button"
              onClick={() => void handleSignOut()}
              disabled={signingOut}
              className="
                flex w-full items-center justify-between gap-2 px-4 py-2
                text-[12.5px] text-danger
                hover:bg-danger/10
                disabled:opacity-50
              "
            >
              <span>{signingOut ? "Signing out…" : "Sign out"}</span>
              <LogOut
                className="h-3 w-3"
                strokeWidth={2}
                aria-hidden
              />
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function computeInitials(displayName: string): string {
  const trimmed = displayName.trim();
  if (!trimmed) return "";
  // If it's an email, use the first two characters of the local-part.
  if (trimmed.includes("@")) {
    return trimmed.slice(0, 2).toUpperCase();
  }
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Dummy reference so unused imports don't fail when the chip is hidden
// behind a media query — keeps the bundler from tree-shaking lucide
// icons we'll need at first paint.
const _IconRefs = { Circle };
void _IconRefs;
