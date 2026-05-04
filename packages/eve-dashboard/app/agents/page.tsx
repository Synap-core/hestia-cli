"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Spinner, Chip, Button, addToast } from "@heroui/react";
import {
  Terminal as TermIcon,
  ArrowRight,
  RefreshCw,
  FileText,
  Workflow,
  AlertCircle,
} from "lucide-react";
import { agentTerminalKinds, type TerminalKind } from "./lib/agent-terminal-map";

interface AgentRow {
  agentType: string;
  label: string;
  description: string;
  status: "ready" | "missing" | "running" | "stopped" | "unknown";
  hasKey: boolean;
  componentInstalled: boolean;
  containerName: string | null;
  containerRunning: boolean | null;
  /** Terminal kinds the agent supports — derived from the registry. */
  kinds: ReadonlyArray<TerminalKind>;
}

const KIND_ICON: Record<TerminalKind, typeof TermIcon> = {
  repl: TermIcon,
  logs: FileText,
  recipe: Workflow,
};

export default function AgentsPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<AgentRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchAgents = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const res = await fetch("/api/agents", { credentials: "include" });
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setLoadError(body.error ?? `API responded with ${res.status}`);
        return;
      }
      const data = (await res.json()) as { agents: AgentRow[] };
      setLoadError(null);
      // Decorate with kinds from the shared map.
      setAgents(
        data.agents.map((a) => ({
          ...a,
          kinds: agentTerminalKinds(a.agentType),
        })),
      );
    } catch (err) {
      setLoadError(`Could not reach API — ${err instanceof Error ? err.message : "Network error"}`);
      if (!silent) addToast({ title: "Failed to load agents", color: "danger" });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [router]);

  useEffect(() => {
    void fetchAgents();
    const interval = setInterval(() => void fetchAgents(true), 30_000);
    return () => clearInterval(interval);
  }, [fetchAgents]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 min-h-[60vh] text-default-500">
        <Spinner size="lg" color="primary" />
        <p className="text-sm">Loading agents…</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-default-500">Agents</p>
          <h1 className="mt-1 font-heading text-3xl font-medium tracking-tightest text-foreground">
            Terminals
          </h1>
          <p className="mt-1 text-default-500">
            Reach every Eve-managed agent through an interactive REPL, log tail, or recipe runner.
          </p>
        </div>
        <Button
          variant="bordered"
          size="sm"
          radius="md"
          isLoading={refreshing}
          startContent={!refreshing ? <RefreshCw className="h-3.5 w-3.5" /> : undefined}
          onPress={() => void fetchAgents()}
        >
          Refresh
        </Button>
      </header>

      {loadError && (
        <div className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm">
          <p className="font-medium text-foreground">Couldn&apos;t load some data</p>
          <p className="mt-0.5 text-default-500">{loadError}</p>
        </div>
      )}

      <section className="rounded-xl border border-divider bg-content1 overflow-hidden">
        {agents && agents.length === 0 ? (
          <div className="p-6 text-sm text-default-500">No agents are currently registered.</div>
        ) : (
          <ul>
            {(agents ?? []).map((agent, i) => (
              <li
                key={agent.agentType}
                className={
                  "flex flex-col gap-3 p-4 sm:flex-row sm:items-center " +
                  (i > 0 ? "border-t border-divider" : "")
                }
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{agent.label}</span>
                    <span className="font-mono text-[11px] text-default-400">{agent.agentType}</span>
                    <StatusChip status={agent.status} />
                    {!agent.hasKey && (
                      <Chip size="sm" color="warning" variant="flat" startContent={<AlertCircle className="h-3 w-3" />}>
                        no key
                      </Chip>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-default-500">{agent.description}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    {agent.kinds.length === 0 ? (
                      <span className="text-[11px] text-default-400">no terminal kinds</span>
                    ) : (
                      agent.kinds.map((k) => {
                        const Icon = KIND_ICON[k];
                        return (
                          <span
                            key={k}
                            className="inline-flex items-center gap-1 rounded-md border border-divider bg-content2 px-1.5 py-0.5 text-[11px] text-default-600"
                          >
                            <Icon className="h-3 w-3" />
                            {k}
                          </span>
                        );
                      })
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Link
                    href={`/agents/${agent.agentType}/terminal`}
                    className={
                      "inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm transition-colors " +
                      (agent.kinds.length > 0
                        ? "border border-divider bg-content1 hover:border-primary/50 hover:text-primary text-default-700"
                        : "border border-divider bg-content2 text-default-400 cursor-not-allowed")
                    }
                    aria-disabled={agent.kinds.length === 0}
                    onClick={(e) => {
                      if (agent.kinds.length === 0) e.preventDefault();
                    }}
                  >
                    Open Terminal
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatusChip({ status }: { status: AgentRow["status"] }) {
  if (status === "ready" || status === "running") {
    return (
      <Chip size="sm" color="success" variant="flat">
        running
      </Chip>
    );
  }
  if (status === "stopped") {
    return (
      <Chip size="sm" color="default" variant="flat">
        stopped
      </Chip>
    );
  }
  if (status === "missing") {
    return (
      <Chip size="sm" color="warning" variant="flat">
        not installed
      </Chip>
    );
  }
  return (
    <Chip size="sm" color="default" variant="flat">
      unknown
    </Chip>
  );
}
