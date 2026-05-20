"use client";

/**
 * `EntityDetailRenderer` — Eve OS's built-in detail renderer.
 *
 * Registered against `cellKey: 'entity-detail'` (the backend's hardcoded
 * detail-slot fallback) and the alias `cellKey: 'form'` (the canonical
 * detail form renderer for Phase 1).
 *
 * Renders one pod entity with HeroField for every property. Title and
 * description go through the dedicated `entities.update` inputs; arbitrary
 * keys under `properties` flow through the same `properties` mutation field.
 *
 * Properties are typed by `classifyValue()` from `@eve/fields`. Real
 * schema-driven rendering (reading `property_defs`) is a follow-up — once
 * the resolver gets the profile's effective property defs as part of the
 * RendererRef config, this component will pick them up automatically.
 *
 * Extracted from the old monolithic `/data/[id]/page.tsx` as part of wiring
 * Eve to the Profile Renderer North Star. The page now mounts
 * `<EntityRenderer>` and dispatches to this renderer via the cell registry.
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
} from "lucide-react";

import {
  classifyValue,
  HeroField,
  HeroFieldList,
  type HeroFieldDef,
  type HeroFieldType,
} from "@eve/fields";

import { PaneHeader } from "../../../components/pane-header";
import type { EveDetailRendererProps } from "../types";

// ─── Profile → icon map (same palette as the graph) ───────────────────────────

const PROFILE_ICON: Record<string, typeof User> = {
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
  person:   "from-success/30 to-success/10",
  contact:  "from-success/30 to-success/10",
  company:  "from-secondary/30 to-secondary/10",
  deal:     "from-warning/30 to-warning/10",
  project:  "from-primary/30 to-primary/10",
  task:     "from-warning/30 to-warning/10",
  document: "from-primary/30 to-primary/10",
  note:     "from-primary/30 to-primary/10",
  event:    "from-default-200 to-default-100",
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

export function EntityDetailRenderer({
  entity,
  onBack,
  patch,
}: EveDetailRendererProps) {
  const slug = entity.profileSlug ?? entity.type ?? "entity";
  const Icon = PROFILE_ICON[slug] ?? Layers;
  const gradient = PROFILE_GRADIENT[slug] ?? "from-default-200 to-default-100";

  // Build HeroField defs from `properties`. Each key is classified by value.
  const propertyFields: HeroFieldDef[] = useMemo(() => {
    const props = entity.properties ?? {};
    return Object.entries(props)
      .filter(([key]) => !SYSTEM_KEYS.has(key))
      .map(([key, value]) =>
        buildFieldDef(key, value, (v) => patch({ properties: { [key]: v } })),
      );
  }, [entity.properties, patch]);

  const systemFields: HeroFieldDef[] = [
    {
      id: "id",
      type: "text",
      label: "ID",
      value: entity.id,
    },
    {
      id: "profileSlug",
      type: "text",
      label: "Profile",
      value: slug,
    },
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
  ];

  return (
    <>
      <PaneHeader title={humanize(slug)} back={onBack} />
      <div className="flex-1 overflow-y-auto animate-pane-content-in">
        <div className="mx-auto max-w-3xl px-5 py-6 sm:py-8 flex flex-col gap-8">
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

          {/* Properties — schema-free, type inferred per value.
              `row` variant keeps the field name visible left of the value
              instead of icon-only inline rendering. Schema-driven rendering
              from property_defs is a follow-up. */}
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

          {/* System fields (read-only) */}
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

          {/* Footer — Back action (mirrors the original page's UX) */}
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
        </div>
      </div>

      {/* Renderer attribution — small visual proof the resolver picked this one */}
      <RendererAttribution cellKey="entity-detail" />
    </>
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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-default-400 px-1">
      {children}
    </h3>
  );
}

function humanize(s: string): string {
  return s.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Field builder ────────────────────────────────────────────────────────────

/**
 * Build a HeroFieldDef for a single property. `classifyValue()` picks the
 * right type from (value, slug). For richer types (status, entity), we'd
 * need property_defs from the pod — that's a follow-up.
 */
function buildFieldDef(
  key: string,
  value: unknown,
  onChange: (v: unknown) => void,
): HeroFieldDef {
  const type: HeroFieldType = classifyValue(value, key);
  const label = humanize(key);

  switch (type) {
    case "text":
    case "email":
    case "phone":
    case "url":
      return {
        id: key,
        type,
        label,
        value: typeof value === "string" ? value : undefined,
        onChange: (v) => onChange(v),
      };

    case "number":
    case "currency":
    case "percent":
      return {
        id: key,
        type,
        label,
        value: typeof value === "number" ? value : undefined,
        onChange: (v) => onChange(v),
      };

    case "date":
      return {
        id: key,
        type: "date",
        label,
        value:
          typeof value === "string"
            ? value
            : value instanceof Date
              ? value.toISOString()
              : undefined,
        relative: true,
        onChange: (v) => onChange(v),
      };

    case "boolean":
      return {
        id: key,
        type: "boolean",
        label,
        value: typeof value === "boolean" ? value : undefined,
        onChange: (v) => onChange(v),
      };

    case "richtext":
      return {
        id: key,
        type: "richtext",
        label,
        value: typeof value === "string" ? value : undefined,
        rows: 3,
        onChange: (v) => onChange(v),
      };

    case "tags":
      return {
        id: key,
        type: "tags",
        label,
        value: Array.isArray(value) ? value.map(String) : undefined,
        allowCustom: true,
        onChange: (v) => onChange(v),
      };

    default:
      return {
        id: key,
        type: "text",
        label,
        value: typeof value === "string" ? value : JSON.stringify(value),
        onChange: (v) => onChange(v),
      };
  }
}
