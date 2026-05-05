"use client";

/**
 * Pulse — Recent issues (collapsible, default closed).
 *
 * A condensed feed of the last 10 doctor-reported issues. Severity is
 * the only sort key (fail before warn) — the doctor itself doesn't
 * timestamp checks, so "recent" really means "currently active". When
 * there are zero non-pass checks the section is hidden entirely (no
 * empty header, no awkward "everything is fine" copy — silence is the
 * green signal here, the headline strip already handled it).
 *
 * Each row has:
 *   • severity Chip (warning for warn, danger for fail)
 *   • title (the check `name`)
 *   • optional fix-suggestion text
 *   • optional Repair button — only when the doctor row carries a
 *     `repair.kind`. POSTs to /api/doctor/repair and triggers a refresh
 *     in the parent on success.
 */

import { useState } from "react";
import { Button, Card, Chip, addToast } from "@heroui/react";
import { ChevronDown, Wrench } from "lucide-react";
import type { CheckResult, DoctorReport } from "./types";

export interface IssuesProps {
  doctor: DoctorReport | null;
  onRepaired: () => void;
}

export function Issues({ doctor, onRepaired }: IssuesProps) {
  const [open, setOpen] = useState(false);

  // Hide entirely when nothing applies — no doctor data, or all green.
  if (!doctor) return null;

  const issues = doctor.checks
    .filter(c => c.status === "fail" || c.status === "warn")
    // Severity sort: fail before warn, then preserve doctor order.
    .sort((a, b) => severityRank(b.status) - severityRank(a.status))
    .slice(0, 10);

  if (issues.length === 0) return null;

  const failCount = doctor.summary.fail;
  const warnCount = doctor.summary.warn;

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="
          group mb-3 flex w-full items-center gap-2
          rounded-md py-1
          focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40
        "
        aria-expanded={open}
      >
        <ChevronDown
          className={
            "h-3.5 w-3.5 text-foreground/55 transition-transform " +
            (open ? "" : "-rotate-90")
          }
          strokeWidth={2.4}
          aria-hidden
        />
        <h2 className="text-[14px] font-medium text-foreground">
          Recent issues
        </h2>
        <span className="text-[11px] text-foreground/45 tabular-nums">
          {issues.length}
        </span>
        <span className="ml-2 text-[11.5px] text-foreground/55">
          {failCount > 0
            ? `${failCount} ${failCount === 1 ? "error" : "errors"}`
            : ""}
          {failCount > 0 && warnCount > 0 ? " · " : ""}
          {warnCount > 0
            ? `${warnCount} ${warnCount === 1 ? "warning" : "warnings"}`
            : ""}
        </span>
      </button>

      {open && (
        <Card
          isBlurred
          shadow="none"
          radius="md"
          className="
            bg-foreground/[0.04] ring-1 ring-inset ring-foreground/10
            divide-y divide-foreground/[0.06]
          "
        >
          {issues.map((issue, idx) => (
            <IssueRow
              key={`${issue.name}-${idx}`}
              issue={issue}
              onRepaired={onRepaired}
            />
          ))}
        </Card>
      )}
    </section>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────────

function IssueRow({
  issue,
  onRepaired,
}: {
  issue: CheckResult;
  onRepaired: () => void;
}) {
  const [repairing, setRepairing] = useState(false);

  const runRepair = async () => {
    if (!issue.repair) return;
    setRepairing(true);
    try {
      const res = await fetch("/api/doctor/repair", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: issue.repair.kind,
          componentId: issue.componentId,
        }),
      });
      const body = await res.json().catch(() => ({})) as {
        ok?: boolean; error?: string; summary?: string;
      };
      if (res.ok && body.ok !== false) {
        addToast({
          title: body.summary ?? `${issue.repair.label} succeeded`,
          color: "success",
        });
        onRepaired();
      } else {
        addToast({
          title: body.error ?? `${issue.repair.label} failed`,
          color: "danger",
        });
      }
    } catch (err) {
      addToast({
        title: err instanceof Error ? err.message : "Repair request failed",
        color: "danger",
      });
    } finally {
      setRepairing(false);
    }
  };

  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="shrink-0 pt-0.5">
        <Chip
          size="sm"
          variant="flat"
          color={issue.status === "fail" ? "danger" : "warning"}
          classNames={{
            base: "h-5",
            content: "text-[10.5px] font-medium uppercase tracking-[0.05em] px-1.5",
          }}
        >
          {issue.status === "fail" ? "Error" : "Warn"}
        </Chip>
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-foreground">
          {issue.name}
        </p>
        <p className="mt-0.5 text-[12px] leading-snug text-foreground/65">
          {issue.message}
        </p>
        {issue.fix && (
          <p className="mt-1 text-[11.5px] text-foreground/45">
            Suggested: {issue.fix}
          </p>
        )}
      </div>

      {issue.repair && (
        <Button
          size="sm"
          radius="full"
          variant="flat"
          color={issue.status === "fail" ? "danger" : "warning"}
          isLoading={repairing}
          startContent={!repairing ? <Wrench className="h-3 w-3" strokeWidth={2.2} /> : undefined}
          onPress={() => void runRepair()}
          className="shrink-0 font-medium"
        >
          {issue.repair.label}
        </Button>
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function severityRank(status: CheckResult["status"]): number {
  if (status === "fail") return 2;
  if (status === "warn") return 1;
  return 0;
}
