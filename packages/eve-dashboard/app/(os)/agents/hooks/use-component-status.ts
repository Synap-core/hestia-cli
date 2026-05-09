"use client";

/**
 * `useComponentStatus` — polls `/api/components` on a 15-second interval
 * and derives per-agent health overrides that the Agents page merges with
 * event-stream statuses.
 *
 * Why separate from `useRealtimeEvents`: the event stream only knows whether
 * an agent has EMITTED events recently; it cannot distinguish "no events"
 * from "component is down". This hook reads entity-state.ts component state
 * and Docker liveness to surface "error" for components that are installed
 * but not running.
 *
 * Merge rule (applied in agents/page.tsx):
 *   • Component error / installed + container not running → force "error"
 *   • Component healthy                                   → event-derived wins
 *   • Component missing / stopped / unknown               → leave event-derived
 */

import { useCallback, useEffect, useState } from "react";
import type { AgentId, AgentLiveStatus } from "../lib/agent-registry";

// Maps component IDs (from entity-state.ts) to the agent IDs they govern.
const COMPONENT_TO_AGENTS: Readonly<Partial<Record<string, readonly AgentId[]>>> = {
  synap:    ["synap", "synap.orchestrator", "synap.coder", "synap.eve"],
  openclaw: ["openclaw"],
  hermes:   ["hermes", "hermes.scrape", "hermes.embed"],
};

export interface ComponentOverride {
  agentStatus: AgentLiveStatus;
  componentState: string | null;
  containerRunning: boolean | null;
}

interface ComponentEntry {
  id: string;
  installed: boolean;
  containerRunning: boolean | null;
  state: string | null;
}

const POLL_MS = 15_000;

export function useComponentStatus(): {
  componentOverrides: Partial<Record<AgentId, ComponentOverride>>;
} {
  const [overrides, setOverrides] = useState<
    Partial<Record<AgentId, ComponentOverride>>
  >({});

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/components", {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) return;

      const data = (await res.json()) as { components: ComponentEntry[] };
      const out: Partial<Record<AgentId, ComponentOverride>> = {};

      for (const c of data.components) {
        const agentIds = COMPONENT_TO_AGENTS[c.id];
        if (!agentIds) continue;

        let agentStatus: AgentLiveStatus = "idle";
        if (
          c.state === "error" ||
          (c.installed && c.containerRunning === false)
        ) {
          agentStatus = "error";
        }
        // "ready" + running → "idle" (event-derived will upgrade to "active")
        // "missing" | "stopped" → "idle" (component not expected to be running)

        const override: ComponentOverride = {
          agentStatus,
          componentState: c.state,
          containerRunning: c.containerRunning,
        };
        for (const id of agentIds) {
          out[id] = override;
        }
      }

      setOverrides(out);
    } catch {
      // Component status is best-effort; the event stream remains the
      // primary UX signal. Swallow to avoid noise in the console.
    }
  }, []);

  useEffect(() => {
    void poll();
    const t = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(t);
  }, [poll]);

  return { componentOverrides: overrides };
}
