"use client";

/**
 * Eve OS — Data detail (`/data/[id]`).
 *
 * Renders one pod entity with `<HeroField>` for every property. Title and
 * description are wired to the dedicated `entities.update` inputs; arbitrary
 * keys under `properties` flow through the same `properties` mutation field
 * (merged client-side then sent as a whole record).
 *
 * Properties are typed by `classifyValue()` from `@eve/fields` so the right
 * input renders without the caller knowing the schema up front. Real
 * schema-driven rendering (reading `property_defs`) is a follow-up.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button, Card, CardBody, Spinner } from "@heroui/react";
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

import { PaneHeader } from "../../components/pane-header";
import { PodNotPairedCard } from "../../inbox/components/pod-not-paired-card";
import {
  podTrpcFetch,
  PodTrpcError,
} from "../../inbox/lib/pod-fetch";

// ─── Domain types ─────────────────────────────────────────────────────────────

interface Entity {
  id: string;
  title?: string | null;
  description?: string | null;
  profileSlug?: string | null;
  type?: string | null;
  properties?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

type DetailState =
  | { kind: "loading" }
  | { kind: "unpaired" }
  | { kind: "missing" }
  | { kind: "error"; message: string }
  | { kind: "ready"; entity: Entity };

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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DataDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [state, setState] = useState<DetailState>({ kind: "loading" });

  // Fetch
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setState({ kind: "loading" });
    (async () => {
      try {
        const result = await podTrpcFetch<{ entity?: Entity }>("entities.get", {
          id,
        });
        if (cancelled) return;
        const entity = result.entity ?? (result as unknown as Entity);
        if (!entity || !entity.id) {
          setState({ kind: "missing" });
          return;
        }
        setState({ kind: "ready", entity });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof PodTrpcError && err.status === 503) {
          setState({ kind: "unpaired" });
          return;
        }
        if (err instanceof PodTrpcError && err.status === 404) {
          setState({ kind: "missing" });
          return;
        }
        setState({
          kind: "error",
          message:
            err instanceof Error ? err.message : "Failed to load entity",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Mutation helper — sends partial patch through entities.update.
  const patch = useCallback(
    async (input: Record<string, unknown>) => {
      if (state.kind !== "ready") return;
      // Optimistic update locally
      const next = { ...state.entity, ...input };
      if ("properties" in input) {
        next.properties = {
          ...(state.entity.properties ?? {}),
          ...(input.properties as Record<string, unknown>),
        };
      }
      setState({ kind: "ready", entity: next });
      try {
        await podTrpcFetch("entities.update", { id, ...input }, {
          method: "POST",
        });
      } catch {
        // Roll back on error — re-fetch authoritative copy.
        try {
          const refreshed = await podTrpcFetch<{ entity?: Entity }>(
            "entities.get",
            { id },
          );
          if (refreshed.entity) {
            setState({ kind: "ready", entity: refreshed.entity });
          }
        } catch {
          /* leave the optimistic state — user will see staleness on next load */
        }
      }
    },
    [id, state],
  );

  if (state.kind === "loading") {
    return (
      <>
        <PaneHeader title="Loading…" back={() => router.push("/data")} />
        <div className="flex flex-1 items-center justify-center py-16">
          <Spinner size="md" />
        </div>
      </>
    );
  }

  if (state.kind === "unpaired") {
    return (
      <>
        <PaneHeader title="Data" back={() => router.push("/data")} />
        <PodNotPairedCard onOpenSettings={() => router.push("/settings")} />
      </>
    );
  }

  if (state.kind === "missing") {
    return (
      <>
        <PaneHeader title="Not found" back={() => router.push("/data")} />
        <div className="flex-1 flex flex-col items-center justify-center text-center py-16 px-6 gap-3">
          <p className="text-[13px] text-default-500">
            We couldn&apos;t find that entity.
          </p>
          <Button
            size="sm"
            variant="flat"
            startContent={<ChevronLeft size={14} />}
            onPress={() => router.push("/data")}
          >
            Back to Data
          </Button>
        </div>
      </>
    );
  }

  if (state.kind === "error") {
    return (
      <>
        <PaneHeader title="Error" back={() => router.push("/data")} />
        <div className="flex-1 flex items-center justify-center p-8">
          <Card shadow="none" className="bg-content1 border border-divider max-w-md w-full">
            <CardBody className="p-6 flex flex-col gap-3 items-start">
              <p className="text-[14px] font-medium text-foreground">
                Failed to load entity
              </p>
              <p className="text-[13px] text-default-500">{state.message}</p>
              <Button
                size="sm"
                variant="flat"
                onPress={() => router.push("/data")}
              >
                Back to Data
              </Button>
            </CardBody>
          </Card>
        </div>
      </>
    );
  }

  return (
    <Detail entity={state.entity} onBack={() => router.push("/data")} patch={patch} />
  );
}

// ─── Detail body ──────────────────────────────────────────────────────────────

function Detail({
  entity,
  onBack,
  patch,
}: {
  entity: Entity;
  onBack: () => void;
  patch: (input: Record<string, unknown>) => Promise<void>;
}) {
  const slug = entity.profileSlug ?? entity.type ?? "entity";
  const Icon = PROFILE_ICON[slug] ?? Layers;
  const gradient = PROFILE_GRADIENT[slug] ?? "from-default-200 to-default-100";

  // Build HeroField defs from `properties`. Each key is classified by value.
  const propertyFields: HeroFieldDef[] = useMemo(() => {
    const props = entity.properties ?? {};
    return Object.entries(props)
      .filter(([key]) => !SYSTEM_KEYS.has(key))
      .map(([key, value]) => buildFieldDef(key, value, (v) =>
        patch({ properties: { [key]: v } }),
      ));
  }, [entity.properties, patch]);

  const systemFields: HeroFieldDef[] = [
    {
      id: "id",
      type: "text",
      label: "ID",
      value: entity.id,
      // No onChange → read-only.
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

          {/* Properties — schema-free, type inferred per value */}
          {propertyFields.length > 0 && (
            <section className="flex flex-col gap-2">
              <SectionLabel>Properties</SectionLabel>
              <div className="rounded-2xl border border-divider bg-default-50 p-3 sm:p-4">
                <HeroFieldList
                  variant="inline"
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
        </div>
      </div>
    </>
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

    // Status / select / multi-select / entity / multi-entity need options or
    // a profile-defined schema to render meaningfully. Without that context
    // we fall back to text so the value is still editable.
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
