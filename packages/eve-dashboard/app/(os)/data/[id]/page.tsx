"use client";

/**
 * Eve OS — Data detail (`/data/[id]`).
 *
 * The showcase page for `@eve/fields`. Renders every supported field
 * type with the right HeroUI input, in three layout variants:
 *
 *   • engagement-grid header  → HeroFieldList variant="card", grid 2-col
 *   • contact panel           → HeroFieldList variant="inline", column
 *   • notes & description     → HeroField type="richtext"
 *
 * Every cell is live: editing fires updateEntity(id, patch) → the list
 * page rerenders via the same subscribe() store.
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button, Spinner } from "@heroui/react";
import { Briefcase, Building2, Layers, User } from "lucide-react";

import {
  CHIP_COLOR_CLASSES,
  HeroField,
  HeroFieldList,
  type EntityRef,
  type HeroFieldDef,
} from "@eve/fields";

import { PaneHeader } from "../../components/pane-header";
import {
  getEntity,
  listEntities,
  searchPeople,
  subscribe,
  updateEntity,
  type SampleEntity,
} from "../lib/sample-data";
import {
  INDUSTRY_OPTIONS,
  SOURCE_OPTIONS,
  STATUS_OPTIONS,
  TAG_PALETTE,
} from "../lib/options";

const TYPE_ICON = {
  contact: User,
  company: Building2,
  deal: Briefcase,
  project: Layers,
} as const;

const TYPE_LABEL: Record<SampleEntity["type"], string> = {
  contact: "Contact",
  company: "Company",
  deal: "Deal",
  project: "Project",
};

// Tailwind gradient classes per entity type so the hero icon picks up the
// brand vibe without needing the OS-level brand-colors registry.
const TYPE_GRADIENT: Record<SampleEntity["type"], string> = {
  contact: "from-violet-400/30 to-violet-600/20 text-violet-200",
  company: "from-sky-400/30 to-sky-600/20 text-sky-200",
  deal:    "from-amber-400/30 to-amber-600/20 text-amber-200",
  project: "from-emerald-400/30 to-emerald-600/20 text-emerald-200",
};

export default function DataDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  // Avoid hydration mismatch — entities live in localStorage.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Subscribe so external updates (rare in detail context, but handy if
  // multiple tabs are open) refresh the form.
  useSyncExternalStore(subscribe, listEntities, () => []);

  const entity = useMemo(
    () => (mounted && id ? getEntity(id) : undefined),
    [mounted, id],
  );

  if (!mounted) {
    return (
      <>
        <PaneHeader title="Loading…" back={() => router.push("/data")} />
        <div className="flex flex-1 items-center justify-center py-16">
          <Spinner size="md" />
        </div>
      </>
    );
  }

  if (!entity) {
    return (
      <>
        <PaneHeader title="Not found" back={() => router.push("/data")} />
        <div className="flex-1 flex flex-col items-center justify-center text-center py-16 px-6">
          <p className="text-[14px] text-foreground/55">
            We couldn't find that entity.
          </p>
          <Button
            size="sm"
            variant="flat"
            className="mt-4"
            onPress={() => router.push("/data")}
          >
            Back to Data
          </Button>
        </div>
      </>
    );
  }

  return <DataDetail entity={entity} onBack={() => router.push("/data")} />;
}

// ─── Detail body ──────────────────────────────────────────────────────────────

function DataDetail({
  entity,
  onBack,
}: {
  entity: SampleEntity;
  onBack: () => void;
}) {
  const Icon = TYPE_ICON[entity.type];
  const statusOpt = STATUS_OPTIONS[entity.type]?.find(
    (o) => o.value === entity.status,
  );
  const statusChip = statusOpt
    ? CHIP_COLOR_CLASSES[statusOpt.color ?? "neutral"]
    : null;

  // Patch helper — every cell sends a partial through here.
  const patch = (p: Partial<SampleEntity>) => updateEntity(entity.id, p);

  // ─── Engagement-grid fields (card variant) ──────────────────────────────────
  const gridFields: HeroFieldDef[] = [
    {
      id: "status",
      type: "status",
      label: "Status",
      value: entity.status,
      options: STATUS_OPTIONS[entity.type],
      onChange: (v) => patch({ status: v ?? "" }),
    },
    {
      id: "value",
      type: "currency",
      label: entity.type === "deal" || entity.type === "company" ? "Value" : "Budget",
      value: entity.value,
      currency: "USD",
      onChange: (v) => patch({ value: v }),
    },
    {
      id: "startDate",
      type: "date",
      label: "Start date",
      value: entity.startDate,
      onChange: (v) => patch({ startDate: v }),
    },
    {
      id: "dueDate",
      type: "date",
      label: "Due date",
      value: entity.dueDate,
      onChange: (v) => patch({ dueDate: v }),
    },
    {
      id: "progress",
      type: "percent",
      label: "Progress",
      value: entity.progress,
      onChange: (v) => patch({ progress: v }),
    },
    {
      id: "source",
      type: "select",
      label: "Source",
      value: entity.source,
      options: SOURCE_OPTIONS,
      allowCustom: true,
      onChange: (v) => patch({ source: v ?? undefined }),
    },
  ];

  // ─── Sidebar inline fields ──────────────────────────────────────────────────
  const aboutFields: HeroFieldDef[] = [
    {
      id: "email",
      type: "email",
      label: "Email",
      placeholder: "Add email",
      value: entity.email,
      onChange: (v) => patch({ email: v }),
    },
    {
      id: "phone",
      type: "phone",
      label: "Phone",
      placeholder: "Add phone",
      value: entity.phone,
      onChange: (v) => patch({ phone: v }),
    },
    {
      id: "website",
      type: "url",
      label: "Website",
      placeholder: "Add website",
      value: entity.website,
      onChange: (v) => patch({ website: v }),
    },
    {
      id: "industry",
      type: "select",
      label: "Industry",
      placeholder: "Pick industry",
      value: entity.industry,
      options: INDUSTRY_OPTIONS,
      allowCustom: true,
      onChange: (v) => patch({ industry: v ?? undefined }),
    },
    {
      id: "owner",
      type: "entity",
      label: "Owner",
      placeholder: "Assign owner",
      value: entity.owner,
      searchEntities: searchPeople,
      searchPlaceholder: "Search people",
      onChange: (v: EntityRef | undefined) => patch({ owner: v }),
    },
    {
      id: "collaborators",
      type: "multi-entity",
      label: "Collaborators",
      placeholder: "Add collaborators",
      value: entity.collaborators,
      searchEntities: searchPeople,
      searchPlaceholder: "Search people",
      onChange: (v: EntityRef[]) => patch({ collaborators: v }),
    },
    {
      id: "tags",
      type: "multi-select",
      label: "Tags",
      placeholder: "Add tags",
      value: entity.tags,
      options: TAG_PALETTE,
      allowCustom: true,
      onChange: (v) => patch({ tags: v }),
    },
    {
      id: "isPriority",
      type: "boolean",
      label: "Priority",
      value: entity.isPriority,
      trueLabel: "High priority",
      falseLabel: "Normal",
      onChange: (v) => patch({ isPriority: v }),
    },
    {
      id: "isArchived",
      type: "boolean",
      label: "Archived",
      value: entity.isArchived,
      trueLabel: "Archived",
      falseLabel: "Active",
      onChange: (v) => patch({ isArchived: v }),
    },
  ];

  return (
    <>
      <PaneHeader title={TYPE_LABEL[entity.type]} back={onBack} />
      <div className="flex-1 overflow-y-auto animate-pane-content-in">
        <div className="mx-auto max-w-3xl px-5 py-6 sm:py-8 flex flex-col gap-8">
          {/* ── Hero ────────────────────────────────────────────────────────── */}
          <header className="flex items-start gap-4">
            <div
              className={`shrink-0 inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-br ${TYPE_GRADIENT[entity.type]} border border-foreground/10`}
            >
              <Icon size={20} />
            </div>
            <div className="flex-1 min-w-0 flex flex-col gap-1">
              <NameEditor
                value={entity.name}
                onChange={(v) => patch({ name: v })}
              />
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[12px] text-foreground/45">
                  {TYPE_LABEL[entity.type]}
                </span>
                {statusOpt && statusChip ? (
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusChip.bg} ${statusChip.text} ${statusChip.border}`}
                  >
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${statusChip.dot}`} />
                    {statusOpt.label}
                  </span>
                ) : null}
              </div>
            </div>
          </header>

          {/* ── Engagement grid ─────────────────────────────────────────────── */}
          <section className="flex flex-col gap-2">
            <SectionLabel>Overview</SectionLabel>
            <HeroFieldList
              variant="card"
              layout="grid"
              columns={2}
              gap={2}
              fields={gridFields}
            />
          </section>

          {/* ── About (inline column) ───────────────────────────────────────── */}
          <section className="flex flex-col gap-2">
            <SectionLabel>About</SectionLabel>
            <div className="rounded-2xl border border-foreground/[0.06] bg-foreground/[0.02] p-3 sm:p-4">
              <HeroFieldList
                variant="inline"
                layout="column"
                gap={1}
                fields={aboutFields}
              />
            </div>
          </section>

          {/* ── Description ─────────────────────────────────────────────────── */}
          <section className="flex flex-col gap-2">
            <SectionLabel>Description</SectionLabel>
            <div className="rounded-2xl border border-foreground/[0.06] bg-foreground/[0.02] px-4 py-3">
              <HeroField
                type="richtext"
                label="Description"
                placeholder="One-line summary of this record…"
                value={entity.description}
                rows={2}
                maxHeight={140}
                onChange={(v) => patch({ description: v })}
              />
            </div>
          </section>

          {/* ── Notes ───────────────────────────────────────────────────────── */}
          <section className="flex flex-col gap-2">
            <SectionLabel>Notes</SectionLabel>
            <div className="rounded-2xl border border-foreground/[0.06] bg-foreground/[0.02] px-4 py-3">
              <HeroField
                type="richtext"
                label="Notes"
                placeholder="Add notes — context, decisions, follow-ups…"
                value={entity.notes}
                rows={4}
                maxHeight={400}
                onChange={(v) => patch({ notes: v })}
              />
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-foreground/40 px-1">
      {children}
    </h3>
  );
}

/**
 * Large editable title. Uses the same read↔write pattern as the cells
 * but with heading typography. Kept inline (not a HeroField) because the
 * page-title slot has no icon/label chrome.
 */
function NameEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  function commit() {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onChange(trimmed);
    else setDraft(value);
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setEditing(false);
            setDraft(value);
          }
        }}
        className="
          w-full bg-transparent outline-none caret-primary
          font-heading text-2xl text-foreground tracking-tight
        "
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="
        text-left font-heading text-2xl text-foreground tracking-tight
        hover:text-foreground/85 transition-colors cursor-text truncate
      "
    >
      {value}
    </button>
  );
}
