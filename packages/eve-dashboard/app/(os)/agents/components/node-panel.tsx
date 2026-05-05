"use client";

/**
 * `NodePanel` — slide-in side panel for the selected agent.
 *
 * Surfaces:
 *   • Glass-icon header with agent's brand gradient
 *   • Status pill (idle / active / error) derived from event stream
 *   • One-line description from the registry
 *   • Subagent strip (small icons + labels) when the agent has children
 *   • Recent activity (last 20 events from this agent)
 *
 * The whole panel is fed by the registry — no hand-rolled actor maps.
 *
 * See: synap-team-docs/content/team/platform/eve-agents-design.mdx §M2
 */

import { Button, Chip } from "@heroui/react";
import { X } from "lucide-react";
import {
  type AgentId,
  type AgentStatusSnapshot,
  brandFor,
  getAgent,
  subagentsOf,
} from "../lib/agent-registry";
import type { AgentEvent } from "../lib/event-types";

export interface NodePanelProps {
  agentId: AgentId | null;
  /** Events filtered to this agent. Pass `byAgent[agentId]` from the hook. */
  events: AgentEvent[];
  status?: AgentStatusSnapshot;
  onClose: () => void;
  onSelectAgent: (id: AgentId) => void;
}

export function NodePanel({
  agentId,
  events,
  status,
  onClose,
  onSelectAgent,
}: NodePanelProps) {
  if (!agentId) return null;
  const agent = getAgent(agentId);
  if (!agent) return null;

  const brand = brandFor(agent);
  const Glyph = agent.glyph;
  const subs = subagentsOf(agent.id);

  const liveStatus = status?.status ?? "idle";

  return (
    <aside
      className="
        absolute inset-y-0 right-0 z-30 flex w-full max-w-[360px] flex-col
        bg-foreground/[0.06] border-l border-foreground/[0.08]
        backdrop-blur-pane
        animate-pane-content-in
      "
      aria-label={`${agent.label} side panel`}
    >
      {/* Header */}
      <header className="flex items-start gap-3 px-4 pt-4 pb-3 border-b border-foreground/[0.06]">
        <span
          className="glass-icon flex h-12 w-12 shrink-0 items-center justify-center rounded-lg"
          style={{ background: brand.bg }}
          aria-hidden
        >
          <Glyph className="h-6 w-6 text-white" strokeWidth={1.8} />
        </span>
        <div className="flex-1 min-w-0">
          <h2 className="text-[15px] font-medium text-foreground">
            {agent.label}
          </h2>
          <Chip
            size="sm"
            radius="full"
            variant="flat"
            color={
              liveStatus === "error"
                ? "danger"
                : liveStatus === "active"
                  ? "success"
                  : "default"
            }
            className="mt-1"
          >
            <span className="text-[10.5px] uppercase tracking-wider">
              {liveStatus}
              {status?.recent60s ? ` · ${status.recent60s}/min` : ""}
            </span>
          </Chip>
        </div>
        <Button
          isIconOnly
          variant="light"
          size="sm"
          radius="full"
          aria-label="Close panel"
          onPress={onClose}
          className="text-foreground/55 hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </Button>
      </header>

      {/* Description */}
      <p className="px-4 py-3 text-[12.5px] leading-relaxed text-foreground/65">
        {agent.description}
      </p>

      {/* Subagents — only when present */}
      {subs.length > 0 && (
        <div className="px-4 pb-2">
          <h3 className="mb-1.5 text-[10.5px] font-medium uppercase tracking-[0.06em] text-foreground/55">
            Subagents
          </h3>
          <div className="flex flex-wrap gap-2">
            {subs.map((sub) => {
              const subBrand = brandFor(sub);
              const SubGlyph = sub.glyph;
              return (
                <button
                  type="button"
                  key={sub.id}
                  onClick={() => onSelectAgent(sub.id)}
                  className="
                    group flex items-center gap-2 rounded-md
                    px-2 py-1.5 text-left
                    transition-colors duration-150
                    hover:bg-foreground/[0.05]
                    focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40
                  "
                >
                  <span
                    className="glass-icon inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                    style={{ background: subBrand.bg }}
                    aria-hidden
                  >
                    <SubGlyph className="h-3.5 w-3.5 text-white" strokeWidth={1.8} />
                  </span>
                  <span className="text-[12px] text-foreground/85">
                    {sub.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent activity */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-2">
        <h3 className="mb-2 text-[10.5px] font-medium uppercase tracking-[0.06em] text-foreground/55">
          Recent activity
        </h3>
        {events.length === 0 ? (
          <p className="py-6 text-center text-[12px] text-foreground/55">
            No recent events.
          </p>
        ) : (
          <ul className="space-y-1">
            {events.map((evt) => (
              <li
                key={evt.id}
                className="
                  flex items-center justify-between gap-2 rounded-md
                  bg-foreground/[0.04] px-2.5 py-1.5
                "
              >
                <p className="text-[11.5px] font-mono text-foreground/85 truncate">
                  {evt.name}
                </p>
                <p className="text-[10.5px] tabular-nums text-foreground/55 shrink-0">
                  {new Date(evt.at).toLocaleTimeString()}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
