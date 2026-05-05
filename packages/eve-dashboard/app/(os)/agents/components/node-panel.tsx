"use client";

/**
 * `NodePanel` — side panel that opens when the operator selects a node
 * in the Flow view.
 *
 * Surfaces the actor's recent activity (last 20 events) + a status pill
 * + a small "what does this do?" caption. Stays in sync with the same
 * realtime stream the Flow + Timeline read from.
 *
 * Sliding-panel UX: enters from the right, scales the surrounding pane
 * dimmer slightly. Closes on Esc or backdrop click (the parent owns
 * dismissal — this component is purely visual).
 */

import { Card, CardBody, Button, Chip } from "@heroui/react";
import { X, Paperclip, Brain, Wrench, type LucideIcon } from "lucide-react";
import {
  type Actor,
  type AgentEvent,
  actorFor,
} from "../lib/event-types";

const ACTOR_GLYPH: Record<Actor, LucideIcon> = {
  openclaw: Paperclip,
  synap:    Brain,
  hermes:   Wrench,
};

const ACTOR_COLOR: Record<Actor, string> = {
  openclaw: "#A78BFA",
  synap:    "#34D399",
  hermes:   "#FBBF24",
};

const ACTOR_TITLE: Record<Actor, string> = {
  openclaw: "OpenClaw",
  synap:    "Synap",
  hermes:   "Hermes",
};

const ACTOR_DESC: Record<Actor, string> = {
  openclaw:
    "Ingress. Listens on every messaging channel you've connected and forwards messages into the Synap brain.",
  synap:
    "Brain. Ingests every signal, decides what to remember, what to act on, and routes replies + tasks.",
  hermes:
    "Execution. Runs the tasks Synap dispatches — agent runs, tool calls, automations, scheduled work.",
};

export interface NodePanelProps {
  actor: Actor | null;
  events: AgentEvent[];
  onClose: () => void;
}

export function NodePanel({ actor, events, onClose }: NodePanelProps) {
  if (!actor) return null;

  const Glyph = ACTOR_GLYPH[actor];
  const accent = ACTOR_COLOR[actor];

  // Filter the buffer to events emitted BY this actor.
  const activity = events.filter(e => actorFor(e.name) === actor).slice(0, 20);
  const hasError = activity.some(e => e.name === "hermes:task:failed");
  const status = hasError ? "error" : activity.length > 0 ? "active" : "idle";

  return (
    <aside
      className="
        absolute inset-y-0 right-0 z-30 flex w-full max-w-[360px] flex-col
        bg-foreground/[0.06] border-l border-foreground/[0.08]
        backdrop-blur-pane
        animate-pane-content-in
      "
      aria-label={`${ACTOR_TITLE[actor]} side panel`}
    >
      {/* Header */}
      <header className="flex items-start gap-3 px-4 pt-4 pb-3 border-b border-foreground/[0.06]">
        <span
          className="glass-icon flex h-12 w-12 shrink-0 items-center justify-center"
          style={{ background: `linear-gradient(180deg, ${accent}, ${accent}99)` }}
          aria-hidden
        >
          <Glyph className="h-6 w-6 text-white" strokeWidth={1.8} />
        </span>
        <div className="flex-1 min-w-0">
          <h2 className="text-[15px] font-medium text-foreground">
            {ACTOR_TITLE[actor]}
          </h2>
          <Chip
            size="sm"
            radius="full"
            variant="flat"
            color={status === "error" ? "danger" : status === "active" ? "success" : "default"}
            className="mt-1"
          >
            <span className="text-[10.5px] uppercase tracking-wider">{status}</span>
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
      <p className="px-4 py-3 text-[12.5px] leading-relaxed text-foreground/70">
        {ACTOR_DESC[actor]}
      </p>

      {/* Activity list */}
      <div className="px-4 pb-4 pt-1">
        <h3 className="mb-2 text-[10.5px] font-medium uppercase tracking-[0.06em] text-foreground/55">
          Recent activity
        </h3>
        {activity.length === 0 ? (
          <p className="py-6 text-center text-[12px] text-foreground/55">
            No recent events.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {activity.map(evt => (
              <li key={evt.id}>
                <Card
                  isBlurred
                  shadow="none"
                  radius="md"
                  classNames={{
                    base: "bg-foreground/[0.04] border border-foreground/[0.06]",
                  }}
                >
                  <CardBody className="px-2.5 py-2">
                    <p className="text-[11.5px] font-mono text-foreground truncate">
                      {evt.name}
                    </p>
                    <p className="text-[10.5px] tabular text-foreground/45">
                      {new Date(evt.at).toLocaleTimeString()}
                    </p>
                  </CardBody>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
