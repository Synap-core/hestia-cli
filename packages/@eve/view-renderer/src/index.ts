// ─── Registration ──────────────────────────────────────────────────────────────

export { registerHeroUIAdapters } from "./register";

// ─── Adapter components (for advanced composition) ────────────────────────────

export { HeroUIKanbanAdapter } from "./adapters/HeroUIKanbanAdapter";
export { HeroUIListAdapter } from "./adapters/HeroUIListAdapter";
export { HeroUITableAdapter } from "./adapters/HeroUITableAdapter";

// ─── Types ────────────────────────────────────────────────────────────────────

export type { ViewAdapterProps, ViewAdapterRegistry, Entity, ViewConfig } from "./types";
