"use client";

/**
 * Doctor — server-driven health report.
 *
 * Single page that mirrors `eve doctor` on the host: platform checks,
 * per-component container state, network reachability, AI provider
 * wiring. Each check carries an optional `fix` hint shown next to it.
 */

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Spinner, Chip, Button, addToast,
} from "@heroui/react";
import {
  RefreshCw, CheckCircle2, AlertTriangle, XCircle, Wrench,
} from "lucide-react";

type RepairKind = "create-eve-network" | "start-container" | "rewire-openclaw";

type IntegrationId =
  | "hermes-synap"
  | "openclaw-synap"
  | "openwebui-synap"
  | "openwebui-pipelines";

interface CheckResult {
  group: "platform" | "containers" | "network" | "ai" | "wiring" | "integrations";
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
  summary: { pass: number; warn: number; fail: number; total: number };
}

const GROUPS: Array<{ id: CheckResult["group"]; label: string; description: string }> = [
  { id: "platform", label: "Platform", description: "Docker daemon + compose plugin." },
  { id: "network", label: "Network", description: "eve-network + per-component reachability." },
  { id: "containers", label: "Containers", description: "Are the things you installed actually running?" },
  { id: "ai", label: "AI providers", description: "Provider keys for the AI fabric." },
  { id: "wiring", label: "Component wiring", description: "Cross-component config (auth-profiles, etc.)." },
  { id: "integrations", label: "Integrations", description: "End-to-end wiring between paired components." },
];

export default function DoctorPage() {
  const router = useRouter();
  const [data, setData] = useState<DoctorResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const res = await fetch("/api/doctor", { credentials: "include" });
      if (res.status === 401) { router.push("/login"); return; }
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [router]);

  const [repairing, setRepairing] = useState<string | null>(null);

  const onRepair = useCallback(async (check: CheckResult) => {
    if (!check.repair) return;
    const key = `${check.group}-${check.name}`;
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

  useEffect(() => { void fetchData(); }, [fetchData]);

  if (loading || !data) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 min-h-[60vh] text-default-500">
        <Spinner size="lg" color="primary" />
        <p className="text-sm">Running diagnostics…</p>
      </div>
    );
  }

  const overall = data.summary.fail > 0 ? "fail" : data.summary.warn > 0 ? "warn" : "pass";

  return (
    <div className="space-y-10">
      {/* Header + summary */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-default-500">Diagnostics</p>
          <h1 className="mt-1 font-heading text-3xl font-medium tracking-tightest text-foreground">
            Doctor
          </h1>
          <p className="mt-1 max-w-2xl text-default-500">
            One page that tells you whether your stack is correctly assembled.
            Mirrors what <code className="font-mono text-xs text-foreground">eve doctor</code> reports on the host.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SummaryChip status={overall} summary={data.summary} />
          <Button
            variant="bordered"
            size="sm"
            radius="md"
            isLoading={refreshing}
            startContent={!refreshing ? <RefreshCw className="h-3.5 w-3.5" /> : undefined}
            onPress={() => void fetchData()}
          >
            Re-run
          </Button>
        </div>
      </header>

      {/* Groups — render only those with at least one check */}
      {GROUPS.map(g => {
        const items = data.checks.filter(c => c.group === g.id);
        if (items.length === 0) return null;
        return (
          <section key={g.id} className="space-y-3">
            <div className="flex items-end justify-between gap-4">
              <div>
                <h2 className="font-heading text-xl font-medium tracking-tightest text-foreground">
                  {g.label}
                </h2>
                <p className="mt-0.5 text-sm text-default-500">{g.description}</p>
              </div>
              <Chip
                size="sm"
                variant="flat"
                color={items.some(i => i.status === "fail") ? "danger" : items.some(i => i.status === "warn") ? "warning" : "success"}
                radius="sm"
              >
                {items.filter(i => i.status === "pass").length}/{items.length} passing
              </Chip>
            </div>
            <div className="overflow-hidden rounded-xl border border-divider bg-content1">
              {items.map((c, i) => (
                <CheckRow
                  key={`${c.group}-${c.name}-${i}`}
                  check={c}
                  isFirst={i === 0}
                  onRepair={() => void onRepair(c)}
                  repairing={repairing === `${c.group}-${c.name}`}
                  anyRepairing={repairing !== null}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function CheckRow({
  check, isFirst, onRepair, repairing, anyRepairing,
}: {
  check: CheckResult;
  isFirst: boolean;
  onRepair: () => void;
  repairing: boolean;
  anyRepairing: boolean;
}) {
  const Icon =
    check.status === "pass" ? CheckCircle2 :
    check.status === "warn" ? AlertTriangle :
    XCircle;
  const tone =
    check.status === "pass" ? "text-success" :
    check.status === "warn" ? "text-warning" :
    "text-danger";

  return (
    <div
      className={
        "flex items-start gap-4 px-4 py-3 transition-colors hover:bg-content2/40 " +
        (isFirst ? "" : "border-t border-divider")
      }
    >
      <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${tone}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">{check.name}</p>
        <p className="text-xs text-default-500">{check.message}</p>
        {check.fix && (
          <p className="mt-1 text-xs text-default-400">
            <span className="text-default-500 font-medium">Fix: </span>
            {check.fix}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {check.repair && (
          <Button
            size="sm"
            variant="bordered"
            radius="md"
            color="primary"
            startContent={!repairing ? <Wrench className="h-3.5 w-3.5" /> : undefined}
            isLoading={repairing}
            isDisabled={anyRepairing && !repairing}
            onPress={onRepair}
          >
            {check.repair.label}
          </Button>
        )}
        {check.componentId && !check.repair && (
          <a
            href={`/dashboard/components`}
            className="text-xs font-medium text-primary hover:underline"
          >
            Open
          </a>
        )}
      </div>
    </div>
  );
}

function SummaryChip({
  status, summary,
}: { status: "pass" | "warn" | "fail"; summary: DoctorResponse["summary"] }) {
  const Icon =
    status === "pass" ? CheckCircle2 :
    status === "warn" ? AlertTriangle :
    XCircle;
  const tone =
    status === "pass" ? "success" :
    status === "warn" ? "warning" :
    "danger";

  const label =
    status === "pass" ? `Healthy · ${summary.pass}/${summary.total}` :
    status === "warn" ? `${summary.warn} warning${summary.warn === 1 ? "" : "s"}` :
    `${summary.fail} failing`;

  return (
    <Chip
      size="md"
      variant="flat"
      color={tone}
      radius="sm"
      startContent={<Icon className="h-3.5 w-3.5" />}
      classNames={{ content: "px-1" }}
    >
      {label}
    </Chip>
  );
}
