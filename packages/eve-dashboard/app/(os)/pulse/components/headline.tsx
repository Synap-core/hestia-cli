"use client";

/**
 * Pulse Headline — the at-a-glance health strip.
 *
 * Renders a single Card with three big numbers in a row, separated by
 * vertical dividers:
 *
 *   Running   |   Degraded   |   Errors
 *
 * "Running"  = installed components whose container is up.
 * "Degraded" = installed components whose container is recorded but not
 *              running (or where we couldn't verify state).
 * "Errors"   = doctor checks with status === "fail" (best-effort —
 *              when the doctor source is unreachable we hide the column
 *              gracefully by showing "—").
 *
 * If all three numbers are at the "happy" floor (running > 0 AND
 * degraded === 0 AND errors === 0), we collapse the strip into a
 * single centred "All systems green" headline.
 */

import { Card } from "@heroui/react";
import { CheckCircle2 } from "lucide-react";
import type { ComponentRow, DoctorReport } from "./types";

export interface HeadlineProps {
  components: ComponentRow[] | null;
  doctor: DoctorReport | null;
}

export function Headline({ components, doctor }: HeadlineProps) {
  // Components: only count things that are installed. The catalog row
  // also returns NOT-installed components (they show up in the catalog
  // tab); they're irrelevant to a "is everything green" question.
  const installed = (components ?? []).filter(c => c.installed);
  const running   = installed.filter(c => c.containerRunning === true).length;
  const degraded  = installed.filter(c => c.containerRunning !== true).length;

  // Errors come from the doctor — fail-status checks are concrete
  // problems with running containers, missing wiring, etc. We use
  // null-vs-number to differentiate "no errors" from "couldn't load
  // doctor".
  const errors = doctor ? doctor.summary.fail : null;

  const allGreen =
    installed.length > 0 &&
    running === installed.length &&
    degraded === 0 &&
    (errors === null || errors === 0);

  return (
    <Card
      isBlurred
      shadow="none"
      radius="md"
      className="
        bg-foreground/[0.04]
        ring-1 ring-inset ring-foreground/10
      "
    >
      {allGreen ? (
        <div className="flex items-center justify-center gap-3 px-6 py-7">
          <span
            className="
              inline-flex h-9 w-9 items-center justify-center rounded-full
              bg-success/15 text-success
            "
            aria-hidden
          >
            <CheckCircle2 className="h-5 w-5" strokeWidth={2} />
          </span>
          <div className="text-center">
            <p className="text-[20px] font-medium leading-tight text-foreground">
              All systems green
            </p>
            <p className="mt-0.5 text-[12px] text-foreground/55">
              {running} {running === 1 ? "component" : "components"} running cleanly
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-stretch px-2 py-4 sm:px-4 sm:py-5">
          <Stat label="Running" value={running} tone="success" />
          <Divider />
          <Stat label="Degraded" value={degraded} tone={degraded > 0 ? "warning" : "muted"} />
          <Divider />
          <Stat
            label="Errors"
            value={errors ?? "—"}
            tone={errors && errors > 0 ? "danger" : "muted"}
          />
        </div>
      )}
    </Card>
  );
}

// ─── Internals ───────────────────────────────────────────────────────────────

type Tone = "success" | "warning" | "danger" | "muted";

const TONE_TEXT: Record<Tone, string> = {
  success: "text-success",
  warning: "text-warning",
  danger:  "text-danger",
  muted:   "text-foreground/40",
};

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone: Tone;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 px-3 py-2">
      <span
        className={
          "text-[28px] font-semibold leading-none tabular-nums sm:text-[32px] " +
          TONE_TEXT[tone]
        }
      >
        {value}
      </span>
      <span className="text-[11.5px] uppercase tracking-[0.06em] text-foreground/55">
        {label}
      </span>
    </div>
  );
}

function Divider() {
  return (
    <div
      aria-hidden
      className="my-2 w-px self-stretch bg-foreground/10"
    />
  );
}
