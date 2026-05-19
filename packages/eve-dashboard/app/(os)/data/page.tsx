"use client";

/**
 * Eve OS — Data (`/data`).
 *
 * Force-directed knowledge graph over the operator's pod entities. Layout +
 * data shape mirrors `synap-app/apps/studio/app/(app)/graph/page.tsx`, ported
 * to Eve's pane chrome and `podTrpcFetch` user-channel proxy.
 *
 * Clicking a node deep-links into `/data/[id]` where every property of the
 * entity is rendered via `<HeroField>`.
 */

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  CardBody,
  Chip,
  Spinner,
  Switch,
  Tab,
  Tabs,
} from "@heroui/react";
import { RefreshCw, Share2 } from "lucide-react";

import { PaneHeader } from "../components/pane-header";
import { PodNotPairedCard } from "../inbox/components/pod-not-paired-card";
import {
  useEntitiesGraph,
  type GraphEntity,
} from "./hooks/use-entities-graph";
import type { LayoutType } from "./components/knowledge-graph-canvas";

// reagraph touches `window` at import time — must be client-only.
const KnowledgeGraphCanvas = dynamic(
  () => import("./components/knowledge-graph-canvas"),
  { ssr: false, loading: () => <CanvasSkeleton /> },
);

type LegendColor = "primary" | "success" | "warning" | "secondary" | "default";

interface LegendBucket {
  label: string;
  color: LegendColor;
  slugs: string[];
}

const LEGEND_BUCKETS: LegendBucket[] = [
  { label: "Projects & docs", color: "primary",   slugs: ["project", "document", "note"] },
  { label: "People",          color: "success",   slugs: ["person", "contact"] },
  { label: "Tasks",           color: "warning",   slugs: ["task"] },
  { label: "Companies",       color: "secondary", slugs: ["company"] },
  { label: "Events & other",  color: "default",   slugs: ["event"] },
];

function colorClasses(c: LegendColor) {
  switch (c) {
    case "primary":   return { bg: "bg-primary/10",   fg: "text-primary",   border: "border-primary/30"   };
    case "success":   return { bg: "bg-success/10",   fg: "text-success",   border: "border-success/30"   };
    case "warning":   return { bg: "bg-warning/10",   fg: "text-warning",   border: "border-warning/30"   };
    case "secondary": return { bg: "bg-secondary/10", fg: "text-secondary", border: "border-secondary/30" };
    default:          return { bg: "bg-default-100",  fg: "text-foreground", border: "border-divider"     };
  }
}

function bucketForSlug(slug: string | null | undefined): LegendBucket {
  if (!slug) return LEGEND_BUCKETS[4];
  return LEGEND_BUCKETS.find((b) => b.slugs.includes(slug)) ?? LEGEND_BUCKETS[4];
}

export default function DataPage() {
  const router = useRouter();
  const [layoutType, setLayoutType] = useState<LayoutType>("forceDirected2d");
  const [showOrphans, setShowOrphans] = useState(true);
  const { state, refresh } = useEntitiesGraph();

  const rawEntities: GraphEntity[] =
    state.kind === "ready" ? state.entities : [];
  const rawRelations =
    state.kind === "ready" ? state.relations : [];

  // ─── Derived data (degree, legend counts, top nodes) ────────────────────────
  const degreeMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rawRelations) {
      m.set(r.sourceId, (m.get(r.sourceId) ?? 0) + 1);
      m.set(r.targetId, (m.get(r.targetId) ?? 0) + 1);
    }
    return m;
  }, [rawRelations]);

  const displayEntities = useMemo(() => {
    if (showOrphans) return rawEntities;
    return rawEntities.filter((e) => (degreeMap.get(e.id) ?? 0) > 0);
  }, [rawEntities, showOrphans, degreeMap]);

  const topEntities = useMemo(() => {
    return [...rawEntities]
      .map((e) => ({
        id: e.id,
        label: (e.title ?? e.id).slice(0, 48),
        type: e.type ?? "default",
        connections: degreeMap.get(e.id) ?? 0,
      }))
      .sort((a, b) => b.connections - a.connections)
      .slice(0, 5);
  }, [rawEntities, degreeMap]);

  const legendWithCounts = useMemo(() => {
    const counts = new Map<LegendColor, number>();
    for (const e of rawEntities) {
      const bucket = bucketForSlug(e.type);
      counts.set(bucket.color, (counts.get(bucket.color) ?? 0) + 1);
    }
    return LEGEND_BUCKETS.map((b) => ({ ...b, count: counts.get(b.color) ?? 0 }));
  }, [rawEntities]);

  const stats = state.kind === "ready" ? state.stats : {};
  const totalEntities = stats.totalEntities ?? stats.nodeCount ?? rawEntities.length;
  const profileTypeCount = stats.entityTypeDistribution
    ? Object.keys(stats.entityTypeDistribution).length
    : new Set(rawEntities.map((e) => e.type ?? "default")).size;

  // ─── States ─────────────────────────────────────────────────────────────────
  if (state.kind === "unpaired") {
    return (
      <>
        <PaneHeader title="Data" />
        <div className="flex-1 overflow-y-auto">
          <PodNotPairedCard onOpenSettings={() => router.push("/settings")} />
        </div>
      </>
    );
  }

  return (
    <>
      <PaneHeader
        title="Data"
        actions={
          <Button
            size="sm"
            variant="light"
            startContent={<RefreshCw size={14} />}
            onPress={refresh}
            className="text-default-500 hover:text-foreground"
          >
            Refresh
          </Button>
        }
      />
      <div className="flex-1 overflow-y-auto animate-pane-content-in">
        <div className="mx-auto max-w-[1280px] px-5 py-6 sm:py-8 flex flex-col gap-4">
          {/* Header copy */}
          <header className="flex flex-col gap-1">
            <h2 className="font-heading text-2xl text-foreground tracking-tight">
              Your graph
            </h2>
            <p className="text-[13px] text-default-500 max-w-xl">
              The connections between your entities, across every workspace
              on your pod. Click a node to open it.
            </p>
          </header>

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_280px] gap-4">
            {/* ── Canvas column ─────────────────────────────────────────── */}
            <div className="flex flex-col gap-2 min-w-0">
              <div className="flex items-center justify-between">
                <Tabs
                  size="sm"
                  radius="md"
                  selectedKey={layoutType}
                  onSelectionChange={(key) =>
                    setLayoutType(key as LayoutType)
                  }
                  aria-label="Graph layout"
                >
                  <Tab key="forceDirected2d" title="Force" />
                  <Tab key="radialOut2d" title="Radial" />
                  <Tab key="treeTd2d" title="Tree" />
                </Tabs>
                <span className="text-[11px] text-default-400">
                  {displayEntities.length} nodes · {rawRelations.length} edges
                </span>
              </div>

              <div className="relative h-[560px] rounded-xl border border-divider bg-content1 overflow-hidden">
                {state.kind === "loading" ? (
                  <CanvasSkeleton />
                ) : state.kind === "error" ? (
                  <ErrorState message={state.message} onRetry={refresh} />
                ) : displayEntities.length === 0 ? (
                  <EmptyState />
                ) : (
                  <KnowledgeGraphCanvas
                    entities={displayEntities}
                    relations={rawRelations}
                    layoutType={layoutType}
                    onNodeClick={(entityId) => router.push(`/data/${entityId}`)}
                  />
                )}
              </div>
            </div>

            {/* ── Sidebar ───────────────────────────────────────────────── */}
            <aside className="flex flex-col gap-3 min-w-0">
              <Card shadow="none" className="border border-divider bg-content1">
                <CardBody className="p-4">
                  <p className="text-[10px] uppercase tracking-widest text-default-400 font-medium mb-3">
                    Top entities
                  </p>
                  {topEntities.length === 0 ? (
                    <p className="text-[12px] text-default-400">
                      No entities yet.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {topEntities.map((n) => {
                        const cls = colorClasses(bucketForSlug(n.type).color);
                        return (
                          <button
                            key={n.id}
                            type="button"
                            onClick={() => router.push(`/data/${n.id}`)}
                            className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-default-100 transition-colors text-left"
                          >
                            <span
                              className={`w-6 h-6 rounded-full flex items-center justify-center ${cls.bg} ${cls.fg} border ${cls.border}`}
                            />
                            <span className="text-[13px] text-foreground truncate flex-1">
                              {n.label}
                            </span>
                            <span className="text-[11px] text-default-400">
                              {n.connections}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </CardBody>
              </Card>

              <Card shadow="none" className="border border-divider bg-content1">
                <CardBody className="p-4">
                  <p className="text-[10px] uppercase tracking-widest text-default-400 font-medium mb-3">
                    Legend
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {legendWithCounts.map((l) => {
                      const cls = colorClasses(l.color);
                      return (
                        <div key={l.label} className="flex items-center gap-2">
                          <span
                            className={`w-2.5 h-2.5 rounded-full ${cls.bg} border ${cls.border}`}
                          />
                          <span className="text-[12px] text-foreground flex-1">
                            {l.label}
                          </span>
                          <span className="text-[11px] text-default-400">
                            {l.count}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </CardBody>
              </Card>

              <Card shadow="none" className="border border-divider bg-content1">
                <CardBody className="p-4 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-[13px] font-medium text-foreground">
                      Show orphans
                    </p>
                    <p className="text-[11px] text-default-500">
                      Nodes with no connections
                    </p>
                  </div>
                  <Switch
                    size="sm"
                    color="primary"
                    isSelected={showOrphans}
                    onValueChange={setShowOrphans}
                  />
                </CardBody>
              </Card>

              <Card shadow="none" className="border border-divider bg-content1">
                <CardBody className="p-4">
                  <Chip
                    size="sm"
                    variant="flat"
                    color={state.kind === "ready" ? "success" : "default"}
                    className="text-[10px] h-5 mb-2"
                  >
                    {state.kind === "ready" ? "Live" : "…"}
                  </Chip>
                  <p className="text-[12px] text-default-500 leading-relaxed">
                    Connected to {totalEntities} entit
                    {totalEntities === 1 ? "y" : "ies"} across {profileTypeCount}{" "}
                    profile type{profileTypeCount === 1 ? "" : "s"}.
                  </p>
                </CardBody>
              </Card>
            </aside>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Sub-states ──────────────────────────────────────────────────────────────

function CanvasSkeleton() {
  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center gap-3"
      style={{
        backgroundImage:
          "radial-gradient(circle at 1px 1px, rgba(120,120,120,0.12) 1px, transparent 0)",
        backgroundSize: "22px 22px",
      }}
    >
      <Spinner size="sm" color="default" />
      <p className="text-[12px] text-default-500">Loading graph…</p>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 gap-3">
      <p className="text-[13px] text-default-500">{message}</p>
      <Button size="sm" variant="flat" onPress={onRetry}>
        Try again
      </Button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <div className="text-center max-w-sm px-6">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-default-100 mb-3">
          <Share2 size={16} strokeWidth={1.5} className="text-default-400" />
        </div>
        <p className="text-[13px] text-default-500 leading-relaxed">
          No entities on your pod yet. Create a few notes, tasks, or people in
          Synap and they&apos;ll show up here as soon as they have relations.
        </p>
      </div>
    </div>
  );
}
