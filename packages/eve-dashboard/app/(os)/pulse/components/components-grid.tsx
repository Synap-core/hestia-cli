"use client";

/**
 * Pulse — Components grid.
 *
 * One compact health card per installed component:
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ [glass-icon]  Synap Pod        [running]     │
 *   │               synap.evehome … · port 4000    │
 *   └──────────────────────────────────────────────┘
 *
 * The card is a link — clicking opens the component's local URL in a
 * new tab when one exists (domainUrl preferred, host port fallback).
 * Cards without a reachable URL render as non-link Cards (still show
 * status, but no hover affordance).
 *
 * Style: matches marketplace/page.tsx — Card with bg-foreground/[0.04],
 * ring-1 ring-inset ring-foreground/10. Glass-icon glyph uses
 * brandColorFor() so each component carries its identity color.
 */

import { Card } from "@heroui/react";
import {
  Box, ExternalLink, Brain, MessageSquare, Sparkles, Code2, Wrench, Users,
  LayoutGrid, Paperclip, Home, Settings as SettingsIcon, Cpu, Rss,
  type LucideIcon,
} from "lucide-react";
import { brandColorFor } from "../../lib/brand-colors";
import type { ComponentRow } from "./types";

const GLYPHS: Record<string, LucideIcon> = {
  Box, MessageSquare, Brain, Sparkles, Code2, Wrench, Users,
  LayoutGrid, Paperclip, Home, Settings: SettingsIcon, Cpu, Rss,
};

export interface ComponentsGridProps {
  components: ComponentRow[] | null;
}

export function ComponentsGrid({ components }: ComponentsGridProps) {
  // Hide the dashboard from itself — it's running by definition; surfacing
  // it in this list adds noise without information.
  const installed = (components ?? [])
    .filter(c => c.installed)
    .filter(c => c.id !== "eve-dashboard");

  return (
    <section>
      <header className="mb-3 flex items-baseline gap-2">
        <h2 className="text-[14px] font-medium text-foreground">Components</h2>
        <span className="text-[11px] text-foreground/45 tabular-nums">
          {installed.length}
        </span>
        <span className="ml-2 text-[11.5px] text-foreground/55">
          Installed services and their live state.
        </span>
      </header>

      {installed.length === 0 ? (
        <Card
          isBlurred
          shadow="none"
          radius="md"
          className="
            bg-foreground/[0.04] ring-1 ring-inset ring-foreground/10
            p-5
          "
        >
          <p className="text-[12.5px] text-foreground/55">
            No components installed yet — add some from the catalog to
            populate this section.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {installed.map(c => <ComponentCard key={c.id} comp={c} />)}
        </div>
      )}
    </section>
  );
}

// ─── Card ────────────────────────────────────────────────────────────────────

function bestUrl(c: ComponentRow): string | null {
  if (c.domainUrl) return c.domainUrl;
  if (c.hostPort && typeof window !== "undefined") {
    return `http://${window.location.hostname}:${c.hostPort}`;
  }
  return null;
}

function ComponentCard({ comp }: { comp: ComponentRow }) {
  const palette = brandColorFor(comp.id);
  const Icon = palette.glyph ? GLYPHS[palette.glyph] ?? Box : Box;
  const href = bestUrl(comp);

  // State derivation — we trust containerRunning where it's defined,
  // and fall back to the recorded state from state.json when the
  // container isn't a typical docker service (containerRunning === null).
  const status = computeStatus(comp);

  const detail = buildDetail(comp);

  const body = (
    <Card
      isBlurred
      shadow="none"
      radius="md"
      className={
        "flex flex-col gap-3 p-4 " +
        "bg-foreground/[0.04] " +
        "ring-1 ring-inset ring-foreground/10 " +
        (href ? "transition-colors hover:bg-foreground/[0.07]" : "")
      }
    >
      <div className="flex items-start gap-3">
        <span
          className="
            glass-icon
            flex h-10 w-10 shrink-0 items-center justify-center
            rounded-lg
          "
          style={{ background: palette.bg }}
          aria-hidden
        >
          <Icon className="h-5 w-5 text-white" strokeWidth={2} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="truncate text-[14px] font-medium leading-tight text-foreground">
              {comp.label}
            </h3>
            <StatePill status={status} />
          </div>
          <p
            className="mt-1 truncate font-mono text-[11px] text-foreground/55"
            title={detail}
          >
            {detail}
          </p>
        </div>

        {href && (
          <ExternalLink
            className="
              h-3.5 w-3.5 shrink-0 mt-0.5 text-foreground/40
              transition-colors group-hover:text-foreground/70
            "
            aria-hidden
          />
        )}
      </div>
    </Card>
  );

  if (!href) return body;

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={`Open ${comp.label}`}
      className="group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-[12px]"
    >
      {body}
    </a>
  );
}

// ─── Status pill ─────────────────────────────────────────────────────────────

type ComponentStatus = "running" | "stopped" | "degraded" | "unknown";

function computeStatus(c: ComponentRow): ComponentStatus {
  // Containerless component — fall back to recorded state.
  if (c.containerName === null) {
    if (c.state === "ready") return "running";
    if (c.state === "error") return "degraded";
    if (c.state === "stopped") return "stopped";
    return "unknown";
  }
  // Has a container — trust live docker state.
  if (c.containerRunning === true) return "running";
  if (c.containerRunning === false) {
    // Container known to docker but not running, vs. recorded-as-error.
    return c.state === "error" ? "degraded" : "stopped";
  }
  return "unknown";
}

const STATUS_STYLES: Record<ComponentStatus, { dot: string; text: string; label: string }> = {
  running:  { dot: "bg-success",    text: "text-success",         label: "running"  },
  stopped:  { dot: "bg-foreground/30", text: "text-foreground/55", label: "stopped"  },
  degraded: { dot: "bg-warning",    text: "text-warning",         label: "degraded" },
  unknown:  { dot: "bg-foreground/20", text: "text-foreground/45", label: "unknown"  },
};

function StatePill({ status }: { status: ComponentStatus }) {
  const s = STATUS_STYLES[status];
  return (
    <span
      className={
        "inline-flex shrink-0 items-center gap-1.5 " +
        "rounded-full bg-foreground/[0.05] px-2 py-0.5 " +
        "text-[10.5px] font-medium tracking-[0.02em] " +
        s.text
      }
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden />
      {s.label}
    </span>
  );
}

// ─── Detail line ─────────────────────────────────────────────────────────────

function buildDetail(c: ComponentRow): string {
  // Prefer the domain — operators recognise hostnames faster than ports.
  if (c.domainUrl) return c.domainUrl.replace(/^https?:\/\//, "");

  // Subdomain may exist even when the domain didn't resolve into a URL
  // (no domain configured yet). Combine with the port for clarity.
  const parts: string[] = [];
  if (c.subdomain) parts.push(c.subdomain);
  if (c.hostPort) parts.push(`port ${c.hostPort}`);
  if (parts.length > 0) return parts.join(" · ");

  // Fall back to the version number if there's nothing else useful.
  if (c.version) return `v${c.version}`;

  // Worst case — show the category. This keeps the line non-empty so
  // the layout doesn't shift.
  return c.category;
}
