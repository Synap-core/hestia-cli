"use client";

/**
 * Eve OS — Data (`/data`).
 *
 * Demo surface for the `@eve/fields` package. Lists a mix of mock
 * entities (contacts, companies, deals, projects). Tapping a tile
 * navigates to `/data/[id]` where every property type is rendered
 * with the right HeroUI input via <HeroField>.
 *
 * State is in-memory + localStorage-backed (see `lib/sample-data.ts`).
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@heroui/react";
import { RotateCcw } from "lucide-react";
import { PaneHeader } from "../components/pane-header";
import {
  listEntities,
  resetEntities,
  subscribe,
  type SampleEntity,
} from "./lib/sample-data";
import { EntityTile } from "./components/entity-tile";

const SECTION_ORDER: SampleEntity["type"][] = [
  "contact",
  "company",
  "deal",
  "project",
];

const SECTION_LABEL: Record<SampleEntity["type"], string> = {
  contact: "People",
  company: "Companies",
  deal: "Deals",
  project: "Projects",
};

export default function DataPage() {
  // Avoid SSR hydration mismatch — entities live in localStorage.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const entities = useSyncExternalStore(
    subscribe,
    () => listEntities(),
    () => [],
  );

  const grouped = SECTION_ORDER.map((type) => ({
    type,
    items: entities.filter((e) => e.type === type),
  }));

  return (
    <>
      <PaneHeader
        title="Data"
        actions={
          <Button
            size="sm"
            variant="light"
            startContent={<RotateCcw size={14} />}
            onPress={() => resetEntities()}
            className="text-foreground/55 hover:text-foreground"
          >
            Reset
          </Button>
        }
      />
      <div className="flex-1 overflow-y-auto animate-pane-content-in">
        <div className="mx-auto max-w-3xl px-5 py-6 sm:py-8 flex flex-col gap-6">
          <header className="flex flex-col gap-1">
            <h2 className="font-heading text-2xl text-foreground tracking-tight">
              Your data
            </h2>
            <p className="text-[13px] text-foreground/55 max-w-xl">
              Five sample entities to show how <code className="text-foreground/75">@eve/fields</code> renders every
              property type — open one to see status pills, calendars,
              entity pickers, currency, tags, and notes editing inline.
            </p>
          </header>

          {!mounted ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-14 rounded-xl bg-foreground/[0.03] animate-pulse"
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              {grouped.map(({ type, items }) =>
                items.length === 0 ? null : (
                  <section key={type} className="flex flex-col gap-1.5">
                    <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-foreground/40 px-1">
                      {SECTION_LABEL[type]}
                    </h3>
                    <div className="flex flex-col gap-1.5">
                      {items.map((e) => (
                        <EntityTile key={e.id} entity={e} />
                      ))}
                    </div>
                  </section>
                ),
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
