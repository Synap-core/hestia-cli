"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Spinner, Chip, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem,
  addToast,
} from "@heroui/react";
import {
  Box, Brain, Wrench, Hammer, Eye, Footprints,
  ExternalLink, Copy, Check, MoreHorizontal, ArrowDownToLine, ChevronRight,
  Maximize2,
  type LucideIcon,
} from "lucide-react";
import { ComponentDetailDrawer } from "./component-detail-drawer";

// ---------------------------------------------------------------------------
// Types — mirror /api/components response shape
// ---------------------------------------------------------------------------

interface ComponentRow {
  id: string;
  label: string;
  emoji: string;
  description: string;
  category: "infrastructure" | "data" | "agent" | "builder" | "perception" | "add-on";
  organ: string | null;
  installed: boolean;
  containerRunning: boolean | null;
  containerName: string | null;
  internalPort: number | null;
  hostPort: number | null;
  subdomain: string | null;
  domainUrl: string | null;
  state: string | null;
  version: string | null;
  requiredBy: string[];
  requires: string[];
  alwaysInstall: boolean;
}

// ---------------------------------------------------------------------------
// Visual mapping — lucide icon per category
// ---------------------------------------------------------------------------

const CATEGORY_LABEL: Record<ComponentRow["category"], string> = {
  infrastructure: "Infrastructure",
  data:           "Data",
  agent:          "Agents & actions",
  builder:        "Builders",
  perception:     "Perception",
  "add-on":       "Add-ons",
};

// Display order: infra first, add-ons last.
const CATEGORY_ORDER: Array<ComponentRow["category"]> = [
  "infrastructure", "data", "agent", "builder", "perception", "add-on",
];

const ORGAN_ICON: Record<string, LucideIcon> = {
  brain:   Brain,
  arms:    Wrench,
  builder: Hammer,
  eyes:    Eye,
  legs:    Footprints,
};

// ---------------------------------------------------------------------------
// Status chip — derived from installed flag + container state
// ---------------------------------------------------------------------------

function statusFor(c: ComponentRow): {
  label: string;
  color: "success" | "warning" | "danger" | "default";
} {
  if (!c.installed) return { label: "available", color: "default" };
  if (c.containerName === null) return { label: "ready", color: "success" };
  if (c.containerRunning === true) return { label: "running", color: "success" };
  if (c.state === "error") return { label: "error", color: "danger" };
  return { label: "stopped", color: "warning" };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ComponentsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<ComponentRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    try {
      const res = await fetch("/api/components", { credentials: "include" });
      if (res.status === 401) { router.push("/login"); return; }
      if (res.ok) {
        const data = await res.json() as { components: ComponentRow[] };
        setRows(data.components);
      }
    } finally { setLoading(false); }
  }, [router]);

  useEffect(() => { void fetchRows(); }, [fetchRows]);

  if (loading || !rows) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 min-h-[60vh] text-default-500">
        <Spinner size="lg" color="primary" />
        <p className="text-sm">Reading registry…</p>
      </div>
    );
  }

  // Group by category, preserve registry order within each group.
  const byCategory = new Map<ComponentRow["category"], ComponentRow[]>();
  for (const c of rows) {
    const list = byCategory.get(c.category) ?? [];
    list.push(c);
    byCategory.set(c.category, list);
  }

  const installedCount = rows.filter(r => r.installed).length;
  const runningCount   = rows.filter(r => r.containerRunning === true).length;

  return (
    <div className="space-y-10">
      {/* -----------------------------------------------------------------
       * Page header
       * -------------------------------------------------------------- */}
      <header>
        <p className="text-sm font-medium text-default-500">Catalog</p>
        <h1 className="mt-1 font-heading text-3xl font-medium tracking-tightest text-foreground">
          Components
        </h1>
        <p className="mt-1 max-w-2xl text-default-500">
          The full catalog of services Eve can run on your stack.{" "}
          <span className="text-foreground">{installedCount} installed</span>
          <span className="text-default-400">{" · "}{runningCount} running</span>.
        </p>
      </header>

      {/* -----------------------------------------------------------------
       * Categories — one section per group
       * -------------------------------------------------------------- */}
      {CATEGORY_ORDER.map(cat => {
        const list = byCategory.get(cat);
        if (!list || list.length === 0) return null;
        return (
          <section key={cat} className="space-y-3">
            <h2 className="text-xs font-medium uppercase tracking-wider text-default-400">
              {CATEGORY_LABEL[cat]}
            </h2>
            <div className="overflow-hidden rounded-xl border border-divider bg-content1">
              {list.map((c, i) => (
                <Row
                  key={c.id}
                  row={c}
                  isFirst={i === 0}
                  onOpen={() => setOpenId(c.id)}
                />
              ))}
            </div>
          </section>
        );
      })}

      {/* -----------------------------------------------------------------
       * Footer — pointer to CLI for installs
       * -------------------------------------------------------------- */}
      <section className="rounded-xl border border-divider bg-content1/60 p-5 text-sm text-default-500">
        <p className="font-medium text-foreground">Adding components</p>
        <p className="mt-1.5">
          The dashboard reads from your stack&apos;s registry — to install or remove,
          run the CLI on the host:
        </p>
        <p className="mt-2 font-mono text-xs text-foreground">
          <code className="rounded bg-content2 px-2 py-1">eve add &lt;component&gt;</code>
          <span className="text-default-400"> · </span>
          <code className="rounded bg-content2 px-2 py-1">eve remove &lt;component&gt;</code>
        </p>
        <p className="mt-2 text-xs text-default-400">
          Per-row &quot;Copy install command&quot; gives you the exact line for each item.
        </p>
      </section>

      {/* Detail drawer — slides in from the right when a row is clicked. */}
      <ComponentDetailDrawer
        componentId={openId}
        isOpen={openId !== null}
        onClose={() => setOpenId(null)}
        onChange={() => void fetchRows()}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

function Row({
  row, isFirst, onOpen,
}: { row: ComponentRow; isFirst: boolean; onOpen: () => void }) {
  const status = statusFor(row);
  const OrganIcon = row.organ ? ORGAN_ICON[row.organ] ?? Box : Box;
  const dim = !row.installed;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={
        "group flex cursor-pointer items-center gap-4 px-4 py-3.5 transition-colors hover:bg-content2/40 focus:outline-none focus-visible:bg-content2/40 " +
        (isFirst ? "" : "border-t border-divider") +
        (dim ? " opacity-70 hover:opacity-100" : "")
      }
    >
      {/* Icon */}
      <span
        className={
          "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg " +
          (dim ? "bg-content2 text-default-400" : "bg-primary/10 text-primary")
        }
      >
        <OrganIcon className="h-4 w-4" />
      </span>

      {/* Label + description */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-foreground">{row.label}</span>
          {row.alwaysInstall && (
            <Chip
              size="sm"
              variant="flat"
              radius="sm"
              classNames={{ content: "text-[10px] font-medium uppercase tracking-wider text-default-500 px-1" }}
            >
              core
            </Chip>
          )}
          {row.requires.length > 0 && (
            <span className="text-[10px] uppercase tracking-wider text-default-400">
              needs {row.requires.join(", ")}
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-default-500" title={row.description}>
          {row.description}
        </p>
      </div>

      {/* Right-rail: status + version + actions.
          stopPropagation everywhere so clicks on these don't also open the drawer. */}
      <div
        className="flex shrink-0 items-center gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="hidden md:flex flex-col items-end text-right gap-0.5">
          <Chip size="sm" color={status.color} variant="flat" radius="sm">
            {status.label}
          </Chip>
          {row.version && (
            <span className="font-mono text-[10px] text-default-400">v{row.version}</span>
          )}
        </div>

        {row.domainUrl && row.installed && (
          <a
            href={row.domainUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-divider bg-content1 px-2.5 py-1.5 text-xs text-default-700 hover:border-primary/50 hover:text-primary transition-colors"
            title={row.domainUrl}
          >
            Open
            <ExternalLink className="h-3 w-3" />
          </a>
        )}

        {/* Quick path to the full page (right-click → open in new tab works). */}
        <Link
          href={`/settings/components/${row.id}`}
          aria-label={`Open ${row.label} full page`}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-default-400 hover:text-foreground hover:bg-content2 transition-colors"
          title="Open full page"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </Link>

        <RowMenu row={row} />

        {/* Affordance — chevron hints the row itself opens detail. */}
        <ChevronRight className="h-4 w-4 shrink-0 text-default-300 transition-colors group-hover:text-default-500" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-row dropdown menu
// ---------------------------------------------------------------------------

function RowMenu({ row }: { row: ComponentRow }) {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (text: string, label: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      addToast({ title: `${label} copied`, color: "success" });
      setTimeout(() => setCopied(null), 1500);
    });
  };

  const installCmd = `eve add ${row.id}`;
  const removeCmd = `eve remove ${row.id}`;
  const restartCmd = row.containerName ? `docker restart ${row.containerName}` : null;
  const logsCmd = row.containerName ? `docker logs -f --tail 200 ${row.containerName}` : null;

  return (
    <Dropdown placement="bottom-end">
      <DropdownTrigger>
        <button
          type="button"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-default-400 hover:text-foreground hover:bg-content2 transition-colors"
          aria-label={`Actions for ${row.label}`}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownTrigger>
      <DropdownMenu aria-label={`Actions for ${row.label}`}>
        {/* Always-available — registry navigation */}
        {!row.installed ? (
          <DropdownItem
            key="install"
            startContent={<ArrowDownToLine className="h-3.5 w-3.5" />}
            description="Run on the host"
            onPress={() => copy(installCmd, "Install command")}
          >
            Copy install command
          </DropdownItem>
        ) : null}

        {row.installed && !row.alwaysInstall ? (
          <DropdownItem
            key="remove"
            startContent={<Copy className="h-3.5 w-3.5" />}
            description="Run on the host"
            onPress={() => copy(removeCmd, "Remove command")}
          >
            Copy remove command
          </DropdownItem>
        ) : null}

        {restartCmd ? (
          <DropdownItem
            key="restart"
            startContent={
              copied === "Restart command"
                ? <Check className="h-3.5 w-3.5 text-primary" />
                : <Copy className="h-3.5 w-3.5" />
            }
            description="Run on the host"
            onPress={() => copy(restartCmd, "Restart command")}
          >
            Copy restart command
          </DropdownItem>
        ) : null}

        {logsCmd ? (
          <DropdownItem
            key="logs"
            startContent={
              copied === "Logs command"
                ? <Check className="h-3.5 w-3.5 text-primary" />
                : <Copy className="h-3.5 w-3.5" />
            }
            description="Run on the host"
            onPress={() => copy(logsCmd, "Logs command")}
          >
            Copy logs command
          </DropdownItem>
        ) : null}
      </DropdownMenu>
    </Dropdown>
  );
}
