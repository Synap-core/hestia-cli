/**
 * Types for @eve/view-renderer.
 *
 * These mirror the shapes from @synap-core/view-renderer (ViewAdapterProps,
 * ViewConfig, Entity) without importing from that workspace. The shapes are
 * kept intentionally minimal — adapters only read what they need.
 */

export interface Entity {
  id: string;
  title?: string | null;
  properties?: Record<string, unknown>;
  updatedAt?: string | Date;
  [key: string]: unknown;
}

export interface ViewConfig {
  category?: string;
  query?: Record<string, unknown>;
  render?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ViewAdapterProps {
  entities: Entity[];
  config: ViewConfig;
  viewId?: string;
  workspaceId?: string | null;
  onEntityClick?: (id: string) => void;
}

/**
 * Minimal duck-typed interface that matches viewAdapterRegistry from
 * @synap-core/view-renderer. Passed as a parameter to registerHeroUIAdapters
 * so this package doesn't need a direct dependency on the Synap workspace.
 */
export interface ViewAdapterRegistry {
  // component is typed as ComponentType<any> to avoid structural incompatibilities
  // across separate pnpm workspaces: @eve/view-renderer's Entity and
  // @synap-core/view-renderer's Entity are identical shapes but different module
  // paths, so TypeScript won't unify them without this escape hatch.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register(descriptor: {
    key: string;
    label: string;
    framework: "heroui" | "tamagui";
    component: React.ComponentType<any>; // cross-workspace boundary
  }): void;
}
