"use client";

/**
 * `EntityDetailRenderer` — Eve OS's built-in detail-slot renderer.
 *
 * Registered against `cellKey: 'entity-detail'` (the backend's hardcoded
 * detail-slot fallback) and the alias `cellKey: 'form'`.
 *
 * Two-column layout:
 * - Main: hero header, description, properties (schema-driven via
 *   `buildSchemaAwareField`), system metadata.
 * - Aside: `RelationsPanel` fed by `relations.getConnections`.
 *
 * Field widgets come from `@eve/fields/HeroField`. When the parent page
 * supplies `effectiveProperties` (fetched from `profiles.get`), the
 * builder uses real schema — `status` becomes a colored Select, dates
 * become Calendars, enum properties become typed dropdowns, etc.
 * Without schema (cross-pod entities, AI-added keys) the builder falls
 * back to `classifyValue()`.
 */

import { useMemo } from "react";
import { Button, Card, CardBody } from "@heroui/react";
import {
  Briefcase,
  Building2,
  Calendar as CalendarIcon,
  ChevronLeft,
  FileText,
  Layers,
  StickyNote,
  User,
  type LucideIcon,
} from "lucide-react";

import {
  HeroField,
  HeroFieldList,
  type HeroFieldDef,
} from "@eve/fields";

import { PaneHeader } from "../../../components/pane-header";
import type { EveDetailRendererProps } from "../../types";

import {
  buildSchemaAwareField,
  type EffectivePropertyDef,
} from "./field-builder";
import { RelationsPanel } from "./relations-panel";

// ─── Profile palette ─────────────────────────────────────────────────────────

const PROFILE_ICON: Record<string, LucideIcon> = {
  person: User,
  contact: User,
  company: Building2,
  deal: Briefcase,
  project: Layers,
  task: Briefcase,
  document: FileText,
  note: StickyNote,
  event: CalendarIcon,
};

const PROFILE_GRADIENT: Record<string, string> = {
  person: "from-success/30 to-success/10",
  contact: "from-success/30 to-success/10",
  company: "from-secondary/30 to-secondary/10",
  deal: "from-warning/30 to-warning/10",
  project: "from-primary/30 to-primary/10",
  task: "from-warning/30 to-warning/10",
  document: "from-primary/30 to-primary/10",
  note: "from-primary/30 to-primary/10",
  event: "from-default-200 to-default-100",
};

const SYSTEM_KEYS = new Set([
  "id",
  "title",
  "name",
  "description",
  "createdAt",
  "updatedAt",
  "profileSlug",
  "type",
  "documentId",
  "workspaceId",
  "globalScope",
]);

// ─── Component ───────────────────────────────────────────────────────────────

export function EntityDetailRenderer({
  entity,
  effectiveProperties,
  connections,
  connectionsLoading,
  onOpenEntity,
  onBack,
  patch,
}: EveDetailRendererProps) {
  const slug = entity.profileSlug ?? entity.type ?? "entity";
  const Icon = PROFILE_ICON[slug] ?? Layers;
  const gradient =
    PROFILE_GRADIENT[slug] ?? "from-default-200 to-default-100";

  // Build a quick lookup from slug → propertyDef so the field builder can
  // pick up uiHints/constraints/valueType per property in O(1).
  const propertyDefBySlug = useMemo(() => {
    const map = new Map<string, EffectivePropertyDef>();
    for (const def of effectiveProperties ?? []) {
      map.set(def.slug, def);
    }
    return map;
  }, [effectiveProperties]);

  // Properties from the entity body (non-system keys), sorted by the
  // property def displayOrder when available so layouts are stable
  // across workspaces.
  const propertyFields: HeroFieldDef[] = useMemo(() => {
    const props = entity.properties ?? {};
    const entries = Object.entries(props).filter(
      ([key]) => !SYSTEM_KEYS.has(key),
    );

    const sorted = entries.sort(([keyA], [keyB]) => {
      const a = propertyDefBySlug.get(keyA)?.displayOrder ?? 999;
      const b = propertyDefBySlug.get(keyB)?.displayOrder ?? 999;
      if (a !== b) return a - b;
      return keyA.localeCompare(keyB);
    });

    return sorted.map(([key, value]) =>
      buildSchemaAwareField({
        key,
        value,
        def: propertyDefBySlug.get(key),
        onChange: (v) => patch({ properties: { [key]: v } }),
      }),
    );
  }, [entity.properties, propertyDefBySlug, patch]);

  const systemFields: HeroFieldDef[] = useMemo(
    () =>
      [
        { id: "id", type: "text", label: "ID", value: entity.id } as const,
        {
          id: "profileSlug",
          type: "text",
          label: "Profile",
          value: slug,
        } as const,
        ...(entity.createdAt
          ? [
              {
                id: "createdAt",
                type: "date" as const,
                label: "Created",
                value: entity.createdAt,
                relative: true,
              },
            ]
          : []),
        ...(entity.updatedAt
          ? [
              {
                id: "updatedAt",
                type: "date" as const,
                label: "Updated",
                value: entity.updatedAt,
                relative: true,
              },
            ]
          : []),
      ] as HeroFieldDef[],
    [entity.id, entity.createdAt, entity.updatedAt, slug],
  );

  return (
    <>
      <PaneHeader title={humanize(slug)} back={onBack} />

      <div className="flex-1 overflow-y-auto animate-pane-content-in">
        <div className="mx-auto max-w-[1400px] px-5 py-6 sm:py-8 flex flex-col lg:flex-row gap-6">
          {/* ── Main column ───────────────────────────────────────────────── */}
          <main className="flex-1 min-w-0 flex flex-col gap-8 lg:max-w-2xl">
            {/* Hero */}
            <header className="flex items-start gap-4">
              <div
                className={`shrink-0 inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-br ${gradient} border border-divider text-foreground`}
              >
                <Icon size={20} />
              </div>
              <div className="flex-1 min-w-0 flex flex-col gap-1">
                <HeroField
                  type="text"
                  label="Title"
                  placeholder="Untitled"
                  value={entity.title ?? ""}
                  size="lg"
                  onChange={(v) => patch({ title: v })}
                />
                <div className="flex items-center gap-2 text-[12px] text-default-400">
                  <span>{humanize(slug)}</span>
                </div>
              </div>
            </header>

            {/* Description */}
            <section className="flex flex-col gap-2">
              <SectionLabel>Description</SectionLabel>
              <div className="rounded-2xl border border-divider bg-default-50 px-4 py-3">
                <HeroField
                  type="richtext"
                  label="Description"
                  placeholder="One-line summary of this record…"
                  value={entity.description ?? ""}
                  rows={2}
                  maxHeight={140}
                  onChange={(v) => patch({ description: v })}
                />
              </div>
            </section>

            {/* Properties */}
            {propertyFields.length > 0 && (
              <section className="flex flex-col gap-2">
                <SectionLabel>Properties</SectionLabel>
                <div className="rounded-2xl border border-divider bg-default-50 p-3 sm:p-4">
                  <HeroFieldList
                    variant="row"
                    layout="column"
                    gap={1}
                    fields={propertyFields}
                  />
                </div>
              </section>
            )}

            {/* System */}
            <section className="flex flex-col gap-2">
              <SectionLabel>System</SectionLabel>
              <div className="rounded-2xl border border-divider bg-default-50 p-3 sm:p-4">
                <HeroFieldList
                  variant="row"
                  layout="column"
                  gap={1}
                  fields={systemFields}
                />
              </div>
            </section>

            {/* Footer */}
            <div className="pt-2">
              <Button
                size="sm"
                variant="flat"
                startContent={<ChevronLeft size={14} />}
                onPress={onBack}
              >
                Back to Data
              </Button>
            </div>
          </main>

          {/* ── Side panel ────────────────────────────────────────────────── */}
          <aside className="lg:w-80 lg:shrink-0 flex flex-col gap-4">
            <RelationsPanel
              connections={connections ?? []}
              loading={connectionsLoading}
              onOpenEntity={onOpenEntity ?? (() => {})}
            />
          </aside>
        </div>
      </div>

      <RendererAttribution cellKey="entity-detail" />
    </>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-default-400 px-1">
      {children}
    </h3>
  );
}

function RendererAttribution({ cellKey }: { cellKey: string }) {
  return (
    <div className="pointer-events-none fixed bottom-3 right-3 z-10">
      <Card
        shadow="none"
        className="border border-divider bg-content1/80 backdrop-blur-sm"
      >
        <CardBody className="px-2.5 py-1">
          <p className="text-[10px] text-default-400 leading-none">
            Renderer:{" "}
            <span className="text-foreground/70 font-mono">{cellKey}</span>
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

function humanize(s: string): string {
  return s.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
