"use client";

/**
 * HeroUIListAdapter
 *
 * Renders entities as a scrollable contact/person list with name, company,
 * email, and status. Mirrors the contacts list in the CRM app.
 */

import React from "react";
import { Building2, Mail, ExternalLink } from "lucide-react";
import type { ViewAdapterProps, Entity } from "../types";

// ─── Row ──────────────────────────────────────────────────────────────────────

function ListRow({
  entity,
  onEntityClick,
}: {
  entity: Entity;
  onEntityClick?: (id: string) => void;
}) {
  const props = entity.properties ?? {};
  const company = props.company as string | undefined;
  const email = props.email as string | undefined;
  const status = props.status as string | undefined;
  const icpScore = props.icpScore as number | undefined;

  return (
    <div
      onClick={() => onEntityClick?.(entity.id)}
      className="flex items-center gap-3 px-4 py-3 border-b border-divider last:border-0 cursor-pointer hover:bg-content1 transition-colors group"
    >
      {/* Avatar */}
      <div className="w-8 h-8 rounded-full bg-foreground/8 flex items-center justify-center shrink-0 text-xs font-semibold text-foreground/50 uppercase">
        {(entity.title ?? "?").charAt(0)}
      </div>

      {/* Name + company */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">
          {entity.title ?? "Unnamed"}
        </p>
        {company && (
          <div className="flex items-center gap-1 mt-px">
            <Building2 size={10} className="text-foreground/30 shrink-0" />
            <p className="text-xs text-foreground/40 truncate">{company}</p>
          </div>
        )}
      </div>

      {/* Email */}
      {email && (
        <a
          href={`mailto:${email}`}
          onClick={(e) => e.stopPropagation()}
          className="hidden sm:flex items-center gap-1 text-xs text-foreground/40 hover:text-primary transition-colors shrink-0"
        >
          <Mail size={11} />
          <span className="truncate max-w-40">{email}</span>
        </a>
      )}

      {/* ICP score */}
      {icpScore !== undefined && (
        <span className="text-[10px] font-mono text-foreground/30 shrink-0 hidden md:block">
          {icpScore}
        </span>
      )}

      {/* Status pill */}
      {status && (
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-foreground/[0.06] text-foreground/50 shrink-0 capitalize hidden sm:block">
          {status}
        </span>
      )}

      {/* Open icon (hover) */}
      <ExternalLink
        size={12}
        className="text-foreground/20 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
      />
    </div>
  );
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export function HeroUIListAdapter({
  entities,
  onEntityClick,
}: ViewAdapterProps) {
  if (entities.length === 0) {
    return (
      <div className="flex items-center justify-center h-32">
        <p className="text-sm text-foreground/30">No items</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col overflow-y-auto">
      {entities.map((entity) => (
        <ListRow key={entity.id} entity={entity} onEntityClick={onEntityClick} />
      ))}
    </div>
  );
}
