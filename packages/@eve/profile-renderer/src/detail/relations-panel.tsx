"use client";

/**
 * `RelationsPanel` — the right-side panel showing everything connected to
 * the current entity.
 *
 * Source: pod's `relations.getConnections` — a single unified endpoint that
 * fans out to:
 *   - **graph**     — typed semantic relations from the `relations` table
 *   - **property**  — structural links via `entity_id` properties on other
 *                     entities (reverse lookup)
 *   - **thread**    — channel mentions / thread context
 *
 * Sections only render when they have content — empty groups stay hidden
 * so the panel looks calm even on sparsely-linked entities. A single
 * "No connections yet" empty state is shown when everything is empty.
 */

import { Layers, Network, MessageSquare } from "lucide-react";

import { EntityChip } from "./entity-chip";

export interface Connection {
  entityId: string;
  entity: {
    id?: string;
    title?: string | null;
    profileSlug?: string | null;
  } | null;
  label: string;
  direction: "outgoing" | "incoming" | "structural";
  source: "graph" | "property" | "thread";
  relationType?: string;
  propertySlug?: string;
  propertyLabel?: string;
  channelId?: string;
  channelRelationshipType?: string;
  createdAt?: string | null;
}

export interface RelationsPanelProps {
  connections: Connection[];
  loading?: boolean;
  onOpenEntity: (entityId: string) => void;
}

export function RelationsPanel({
  connections,
  loading,
  onOpenEntity,
}: RelationsPanelProps) {
  const graph = connections.filter((c) => c.source === "graph");
  const property = connections.filter((c) => c.source === "property");
  const thread = connections.filter((c) => c.source === "thread");

  const isEmpty =
    !loading && graph.length === 0 && property.length === 0 && thread.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <SectionLabel>Connections</SectionLabel>

      {loading ? (
        <SkeletonRows count={3} />
      ) : isEmpty ? (
        <EmptyState />
      ) : (
        <>
          {graph.length > 0 && (
            <Section
              title="Related"
              icon={Network}
              connections={graph}
              onOpenEntity={onOpenEntity}
              labelFor={(c) => c.relationType ?? c.label ?? "related"}
            />
          )}

          {property.length > 0 && (
            <Section
              title="Referenced in"
              icon={Layers}
              connections={property}
              onOpenEntity={onOpenEntity}
              labelFor={(c) =>
                c.propertyLabel ?? c.propertySlug ?? c.label ?? "linked"
              }
            />
          )}

          {thread.length > 0 && (
            <Section
              title="Mentioned in channels"
              icon={MessageSquare}
              connections={thread}
              onOpenEntity={onOpenEntity}
              labelFor={(c) =>
                c.channelRelationshipType ?? c.label ?? "channel"
              }
            />
          )}
        </>
      )}
    </div>
  );
}

// ─── Sections ─────────────────────────────────────────────────────────────────

function Section({
  title,
  icon: Icon,
  connections,
  onOpenEntity,
  labelFor,
}: {
  title: string;
  icon: typeof Network;
  connections: Connection[];
  onOpenEntity: (id: string) => void;
  labelFor: (c: Connection) => string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 px-1">
        <Icon size={11} className="text-default-400" />
        <span className="text-[10px] uppercase tracking-[0.08em] font-medium text-default-500">
          {title}
        </span>
        <span className="text-[10px] text-default-400 ml-auto">
          {connections.length}
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        {connections.map((c, i) => (
          <ConnectionRow
            key={`${c.entityId}:${c.relationType ?? c.propertySlug ?? "rel"}:${i}`}
            connection={c}
            label={labelFor(c)}
            onOpen={onOpenEntity}
          />
        ))}
      </div>
    </div>
  );
}

function ConnectionRow({
  connection,
  label,
  onOpen,
}: {
  connection: Connection;
  label: string;
  onOpen: (id: string) => void;
}) {
  const dirHint =
    connection.direction === "outgoing"
      ? "→"
      : connection.direction === "incoming"
        ? "←"
        : "•";

  return (
    <EntityChip
      entityId={connection.entityId}
      label={connection.entity?.title ?? null}
      profileSlug={connection.entity?.profileSlug ?? null}
      meta={`${dirHint} ${humanize(label)}`}
      onOpen={onOpen}
    />
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-default-400 px-1">
      {children}
    </h3>
  );
}

function EmptyState() {
  return (
    <div className="px-2 py-6 rounded-xl border border-divider border-dashed bg-default-50/30 text-center">
      <p className="text-[12px] text-default-400 leading-relaxed">
        No connections yet.
      </p>
      <p className="text-[11px] text-default-400 leading-relaxed mt-1">
        Link this entity to others, or reference it from another entity's
        properties.
      </p>
    </div>
  );
}

function SkeletonRows({ count }: { count: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="h-10 rounded-md border border-divider bg-default-50 animate-pulse"
        />
      ))}
    </div>
  );
}

function humanize(s: string): string {
  return s.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
