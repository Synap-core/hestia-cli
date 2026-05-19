"use client";

import Link from "next/link";
import { Briefcase, Building2, Layers, User } from "lucide-react";
import { CHIP_COLOR_CLASSES } from "@eve/fields";
import type { SampleEntity } from "../lib/sample-data";
import { STATUS_OPTIONS } from "../lib/options";

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

interface Props {
  entity: SampleEntity;
}

export function EntityTile({ entity }: Props) {
  const Icon = TYPE_ICON[entity.type];
  const statusOpt = STATUS_OPTIONS[entity.type]?.find(
    (o) => o.value === entity.status,
  );
  const chip = statusOpt
    ? CHIP_COLOR_CLASSES[statusOpt.color ?? "neutral"]
    : CHIP_COLOR_CLASSES.neutral;

  return (
    <Link
      href={`/data/${entity.id}`}
      className="
        group flex items-center gap-3 rounded-xl border border-foreground/[0.06]
        bg-foreground/[0.02] hover:bg-foreground/[0.04] hover:border-foreground/15
        transition-colors px-3 py-2.5
      "
    >
      <span
        className="
          shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-lg
          bg-foreground/[0.04] text-foreground/55
          group-hover:text-foreground/75 transition-colors
        "
      >
        <Icon size={16} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-medium text-foreground truncate">
            {entity.name}
          </span>
          {statusOpt ? (
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${chip.bg} ${chip.text} ${chip.border}`}
            >
              <span className={`inline-block w-1 h-1 rounded-full ${chip.dot}`} />
              {statusOpt.label}
            </span>
          ) : null}
          {entity.isPriority ? (
            <span className="inline-block w-1 h-1 rounded-full bg-amber-400" />
          ) : null}
        </div>
        <div className="text-[11px] text-foreground/45 truncate mt-0.5">
          {TYPE_LABEL[entity.type]}
          {entity.description ? ` · ${entity.description.split(".")[0]}` : ""}
        </div>
      </div>
      <span className="text-foreground/25 group-hover:text-foreground/55 transition-colors text-[18px] leading-none">
        ›
      </span>
    </Link>
  );
}
