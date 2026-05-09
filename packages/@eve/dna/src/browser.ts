/**
 * Browser-safe entrypoint for @eve/dna.
 *
 * The main package barrel exports Node-backed managers that depend on modules
 * like fs and child_process. Client components must import from this subpath
 * so bundlers do not pull those server-only modules into the browser bundle.
 */

export {
  type AllowedEmbedOriginChecker,
  type AllowedEmbedOriginInput,
  type AllowedEmbedOrigins,
  createAllowedEmbedOriginChecker,
  isAllowedEmbedOrigin,
} from './allowed-origins.js';
