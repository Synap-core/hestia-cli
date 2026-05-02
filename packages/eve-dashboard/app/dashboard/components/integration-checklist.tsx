"use client";

/**
 * Integration checklist — pulls the Doctor report and surfaces just the
 * checks tagged with a specific `integrationId`. Lets the Hermes drawer and
 * the Channels page reuse the same wiring logic without duplicating it.
 *
 * If every check passes the section collapses to a single green line so it
 * doesn't crowd the surrounding surface.
 */

import { useEffect, useState, useCallback } from "react";
import { Spinner, Button, Chip, addToast } from "@heroui/react";
import {
  CheckCircle2, AlertTriangle, XCircle, RefreshCw, Wrench,
} from "lucide-react";

type IntegrationId =
  | "hermes-synap"
  | "openclaw-synap"
  | "openwebui-synap"
  | "openwebui-pipelines";

type RepairKind = "create-eve-network" | "start-container" | "rewire-openclaw";

interface CheckResult {
  group: string;
  name: string;
  status: "pass" | "fail" | "warn";
  message: string;
  fix?: string;
  componentId?: string;
  repair?: { kind: RepairKind; label: string };
  integrationId?: IntegrationId;
}

interface DoctorResponse {
  checks: CheckResult[];
}

export function IntegrationChecklist({
  integrationId,
  title,
  description,
}: {
  integrationId: IntegrationId;
  title: string;
  description?: string;
}) {
  const [checks, setChecks] = useState<CheckResult[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [repairing, setRepairing] = useState<string | null>(null);

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const res = await fetch("/api/doctor", { credentials: "include" });
      if (res.ok) {
        const data = await res.json() as DoctorResponse;
        setChecks(data.checks.filter(c => c.integrationId === integrationId));
      }
    } finally { setRefreshing(false); }
  }, [integrationId]);

  useEffect(() => { void fetchData(true); }, [fetchData]);

  const onRepair = useCallback(async (check: CheckResult) => {
    if (!check.repair) return;
    const key = `${check.name}`;
    setRepairing(key);
    try {
      const res = await fetch("/api/doctor/repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          kind: check.repair.kind,
          componentId: check.componentId,
        }),
      });
      const data = await res.json().catch(() => ({})) as { summary?: string; error?: string };
      if (res.ok) {
        addToast({ title: data.summary ?? "Repair complete", color: "success" });
      } else {
        addToast({ title: data.error ?? "Repair failed", color: "danger" });
      }
      void fetchData(true);
    } catch (err) {
      addToast({
        title: err instanceof Error ? err.message : "Repair failed",
        color: "danger",
      });
    } finally { setRepairing(null); }
  }, [fetchData]);

  if (checks === null) {
    return (
      <div className="rounded-lg border border-divider bg-content2/40 p-4 flex items-center gap-3">
        <Spinner size="sm" />
        <span className="text-xs text-default-500">Checking {title.toLowerCase()}…</span>
      </div>
    );
  }

  if (checks.length === 0) return null;

  const total = checks.length;
  const passing = checks.filter(c => c.status === "pass").length;
  const failing = checks.some(c => c.status === "fail");
  const warning = !failing && checks.some(c => c.status === "warn");
  const allGreen = passing === total;

  return (
    <div className="rounded-lg border border-divider bg-content2/40 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-default-500">
            <span>{title}</span>
            <Chip
              size="sm"
              variant="flat"
              radius="sm"
              color={failing ? "danger" : warning ? "warning" : "success"}
            >
              {passing}/{total} ready
            </Chip>
          </div>
          {description && (
            <p className="mt-1 text-xs text-default-500">{description}</p>
          )}
        </div>
        <Button
          size="sm"
          variant="light"
          radius="md"
          isIconOnly
          isLoading={refreshing}
          onPress={() => void fetchData()}
          aria-label="Re-check"
        >
          {!refreshing && <RefreshCw className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {allGreen ? (
        <div className="flex items-center gap-2 text-xs text-success">
          <CheckCircle2 className="h-3.5 w-3.5" />
          <span>All wired — nothing to do.</span>
        </div>
      ) : (
        <ul className="space-y-2">
          {checks.map((c) => {
            const Icon =
              c.status === "pass" ? CheckCircle2 :
              c.status === "warn" ? AlertTriangle :
              XCircle;
            const tone =
              c.status === "pass" ? "text-success" :
              c.status === "warn" ? "text-warning" :
              "text-danger";
            return (
              <li
                key={c.name}
                className="flex items-start gap-3 rounded-md border border-divider bg-content1 px-3 py-2"
              >
                <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${tone}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground">{c.name}</p>
                  <p className="text-xs text-default-500">{c.message}</p>
                  {c.fix && c.status !== "pass" && (
                    <p className="mt-1 text-xs text-default-400">
                      <span className="font-medium text-default-500">Fix: </span>
                      {c.fix}
                    </p>
                  )}
                </div>
                {c.repair && c.status !== "pass" && (
                  <Button
                    size="sm"
                    variant="bordered"
                    radius="md"
                    color="primary"
                    isLoading={repairing === c.name}
                    isDisabled={repairing !== null && repairing !== c.name}
                    startContent={
                      repairing !== c.name ? <Wrench className="h-3.5 w-3.5" /> : undefined
                    }
                    onPress={() => void onRepair(c)}
                  >
                    {c.repair.label}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
