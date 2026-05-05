"use client";

/**
 * Agents app — live view of the agentic triangle.
 *
 *   OpenClaw  →  Synap  →  Hermes
 *
 * Two views, toggled in the pane header:
 *
 *   • Flow      — n8n-style node graph with traveling-light edges.
 *                 Click a node → side panel with that actor's last 20
 *                 events.
 *   • Timeline  — chronological event list with filter chips and a
 *                 privacy-aware excerpt toggle.
 *
 * Both views read from the same `useRealtimeEvents` hook so switching
 * panels is instant — no second connection, no buffer reset.
 *
 * The "Connect channels" button at top-right opens a modal where the
 * operator wires Telegram / Discord / WhatsApp to OpenClaw.
 *
 * See: synap-team-docs/content/team/platform/eve-agents-design.mdx
 */

import { useState } from "react";
import {
  Button, ButtonGroup, Card, CardBody, Spinner,
} from "@heroui/react";
import {
  Workflow, List, Plug, AlertTriangle, RefreshCw, Sparkles,
} from "lucide-react";
import { PaneHeader } from "../components/pane-header";
import { TimelineView } from "./components/timeline-view";
import { FlowView } from "./components/flow-view";
import { NodePanel } from "./components/node-panel";
import { ConnectChannelsModal } from "./components/connect-channels-modal";
import { useRealtimeEvents } from "./hooks/use-realtime-events";
import type { Actor } from "./lib/event-types";

type ViewMode = "flow" | "timeline";

export default function AgentsPage() {
  const [view, setView] = useState<ViewMode>("flow");
  const [selectedActor, setSelectedActor] = useState<Actor | null>(null);
  const [isConnectOpen, setIsConnectOpen] = useState(false);
  const { events, status, reconnect } = useRealtimeEvents({ bufferSize: 200 });

  const isUnauthenticated = status.kind === "unauthenticated";
  const isConnecting = status.kind === "connecting";
  const isError = status.kind === "error";
  const isEmpty = events.length === 0;

  return (
    <>
      <PaneHeader
        title="Agents"
        actions={
          <>
            <ButtonGroup size="sm" radius="full" variant="flat">
              <Button
                isIconOnly
                aria-label="Flow view"
                onPress={() => setView("flow")}
                color={view === "flow" ? "primary" : "default"}
                variant={view === "flow" ? "solid" : "flat"}
              >
                <Workflow className="h-3.5 w-3.5" />
              </Button>
              <Button
                isIconOnly
                aria-label="Timeline view"
                onPress={() => setView("timeline")}
                color={view === "timeline" ? "primary" : "default"}
                variant={view === "timeline" ? "solid" : "flat"}
              >
                <List className="h-3.5 w-3.5" />
              </Button>
            </ButtonGroup>
            <Button
              size="sm"
              radius="full"
              color="primary"
              variant="flat"
              startContent={<Plug className="h-3.5 w-3.5" />}
              onPress={() => setIsConnectOpen(true)}
              className="ml-1"
            >
              Connect
            </Button>
          </>
        }
      />

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden px-5 pb-5 pt-4 sm:px-6 sm:pt-5">
        {/* Status banner — only when relevant */}
        {(isUnauthenticated || isError || isConnecting) && (
          <div className="mb-3">
            {isUnauthenticated && <UnpairedBanner />}
            {isError && status.kind === "error" && (
              <ErrorBanner message={status.message} onRetry={reconnect} />
            )}
            {isConnecting && <ConnectingBanner />}
          </div>
        )}

        {/* Main content area — view switch */}
        <div className="relative min-h-0 flex-1">
          {view === "flow" ? (
            <FlowView events={events} onSelectActor={setSelectedActor} />
          ) : (
            <TimelineView events={events} isEmpty={isEmpty} />
          )}

          {/* Side panel slides in over the Flow view when an actor is selected. */}
          {view === "flow" && selectedActor && (
            <NodePanel
              actor={selectedActor}
              events={events}
              onClose={() => setSelectedActor(null)}
            />
          )}
        </div>

        {/* First-run helper for empty Flow view */}
        {view === "flow" && isEmpty && status.kind === "connected" && (
          <FirstRunHint onOpenConnect={() => setIsConnectOpen(true)} />
        )}
      </div>

      <ConnectChannelsModal
        isOpen={isConnectOpen}
        onClose={() => setIsConnectOpen(false)}
      />
    </>
  );
}

// ── Status banners ───────────────────────────────────────────────────────────

function UnpairedBanner() {
  return (
    <Card
      isBlurred
      shadow="none"
      radius="lg"
      classNames={{ base: "bg-warning/10 border border-warning/30" }}
    >
      <CardBody className="flex flex-row items-center gap-3 px-4 py-2.5">
        <AlertTriangle className="h-4 w-4 shrink-0 text-warning" strokeWidth={2} />
        <div className="flex-1 min-w-0 text-[13px] text-foreground">
          <span className="font-medium">Pod not paired.</span>{" "}
          <span className="text-foreground/60">
            Open Settings → Components and finish the Synap pod setup.
          </span>
        </div>
      </CardBody>
    </Card>
  );
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card
      isBlurred
      shadow="none"
      radius="lg"
      classNames={{ base: "bg-danger/10 border border-danger/30" }}
    >
      <CardBody className="flex flex-row items-center gap-3 px-4 py-2.5">
        <AlertTriangle className="h-4 w-4 shrink-0 text-danger" strokeWidth={2} />
        <p className="flex-1 min-w-0 text-[13px] text-foreground">
          Realtime stream error <span className="text-foreground/55">— {message}</span>
        </p>
        <Button
          size="sm"
          radius="full"
          color="danger"
          variant="flat"
          startContent={<RefreshCw className="h-3 w-3" />}
          onPress={onRetry}
        >
          Retry
        </Button>
      </CardBody>
    </Card>
  );
}

function ConnectingBanner() {
  return (
    <Card
      isBlurred
      shadow="none"
      radius="lg"
      classNames={{ base: "bg-foreground/[0.04] border border-foreground/[0.08]" }}
    >
      <CardBody className="flex flex-row items-center gap-3 px-4 py-2.5">
        <Spinner size="sm" color="primary" />
        <p className="flex-1 min-w-0 text-[13px] text-foreground/70">
          Connecting to your pod's realtime stream…
        </p>
      </CardBody>
    </Card>
  );
}

function FirstRunHint({ onOpenConnect }: { onOpenConnect: () => void }) {
  return (
    <div className="absolute inset-x-0 bottom-6 flex justify-center pointer-events-none">
      <Card
        isBlurred
        shadow="none"
        radius="lg"
        classNames={{
          base: "bg-foreground/[0.06] border border-foreground/[0.10] pointer-events-auto",
        }}
      >
        <CardBody className="flex flex-row items-center gap-3 px-4 py-2.5">
          <Sparkles className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.8} />
          <p className="text-[12.5px] text-foreground/80">
            Waiting for activity. Connect a channel to see your AI staff at work.
          </p>
          <Button
            size="sm"
            radius="full"
            color="primary"
            variant="flat"
            onPress={onOpenConnect}
          >
            Connect a channel
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}
