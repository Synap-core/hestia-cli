"use client";

/**
 * `EntityChip` — a small clickable reference to another pod entity.
 *
 * Used inside `RelationsPanel` and (eventually) inline by the field
 * builder for `valueType: 'entity_id'` properties.
 *
 * We deliberately don't fetch the target entity by id here — that would
 * mean N+1 round-trips on a detail page. The chip displays whatever
 * `label` the caller provides (typically `entity.title` from the connection
 * payload, or `entity.id.slice(0, 8)` as a fallback) and an icon picked
 * from the same map the rest of the data app uses.
 */

import {
  Briefcase,
  Building2,
  Calendar as CalendarIcon,
  FileText,
  Layers,
  StickyNote,
  User,
  type LucideIcon,
} from "lucide-react";

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

export interface EntityChipProps {
  entityId: string;
  label?: string | null;
  profileSlug?: string | null;
  /** Optional sub-label shown muted to the right. */
  meta?: string | null;
  onOpen?: (entityId: string) => void;
}

export function EntityChip({
  entityId,
  label,
  profileSlug,
  meta,
  onOpen,
}: EntityChipProps) {
  const Icon = PROFILE_ICON[profileSlug ?? ""] ?? Layers;
  const display =
    (label && label.trim()) || `${entityId.slice(0, 8)}…`;

  const inner = (
    <span className="flex items-center gap-2 min-w-0">
      <span className="shrink-0 w-6 h-6 rounded-md flex items-center justify-center bg-default-100 text-foreground border border-divider">
        <Icon size={12} />
      </span>
      <span className="flex-1 min-w-0 text-[13px] text-foreground truncate">
        {display}
      </span>
      {meta ? (
        <span className="shrink-0 text-[11px] text-default-400 truncate max-w-[120px]">
          {meta}
        </span>
      ) : null}
    </span>
  );

  if (!onOpen) {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5 rounded-md border border-divider bg-default-50">
        {inner}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(entityId)}
      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md border border-divider bg-default-50 hover:bg-default-100 hover:border-default-300 transition-colors text-left"
    >
      {inner}
    </button>
  );
}
