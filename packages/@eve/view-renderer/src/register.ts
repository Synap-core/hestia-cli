/**
 * registerHeroUIAdapters
 *
 * Registers the three HeroUI view adapters into the provided registry.
 *
 * The registry parameter is duck-typed so this package does not need a direct
 * dependency on @synap-core/view-renderer (which lives in a separate pnpm
 * workspace). Callers pass the singleton `viewAdapterRegistry` from that
 * package.
 *
 * Usage (in apps/crm/lib/registerAll.ts or equivalent):
 *
 *   import { viewAdapterRegistry } from '@synap-core/view-renderer';
 *   import { registerHeroUIAdapters } from '@eve/view-renderer';
 *   registerHeroUIAdapters(viewAdapterRegistry);
 */

import type { ComponentType } from "react";
import type { ViewAdapterRegistry, ViewAdapterProps } from "./types";
import { HeroUIKanbanAdapter } from "./adapters/HeroUIKanbanAdapter";
import { HeroUIListAdapter } from "./adapters/HeroUIListAdapter";
import { HeroUITableAdapter } from "./adapters/HeroUITableAdapter";

let registered = false;

export function registerHeroUIAdapters(registry: ViewAdapterRegistry): void {
  if (registered) return;
  registered = true;

  registry.register({
    key: "heroui-kanban",
    label: "Kanban (HeroUI)",
    framework: "heroui",
    component: HeroUIKanbanAdapter as ComponentType<ViewAdapterProps>,
  });

  registry.register({
    key: "heroui-list",
    label: "List (HeroUI)",
    framework: "heroui",
    component: HeroUIListAdapter as ComponentType<ViewAdapterProps>,
  });

  registry.register({
    key: "heroui-table",
    label: "Table (HeroUI)",
    framework: "heroui",
    component: HeroUITableAdapter as ComponentType<ViewAdapterProps>,
  });
}

