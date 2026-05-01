/**
 * Component registry — re-export from @eve/dna.
 *
 * The actual definition lives in `@eve/dna/src/components.ts` so all packages
 * (cli, legs, dashboard) can derive routing, access URLs, and health checks
 * from the same source of truth.
 */
export {
  type ComponentInfo,
  COMPONENTS,
  resolveComponent,
  allComponentIds,
  addonComponentIds,
  selectedIds,
} from '@eve/dna';
