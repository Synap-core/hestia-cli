/**
 * EvePoller — minimal interface that all daemon pollers must implement.
 * Built-in pollers (TaskPoller, IntentPoller, FeaturePoller) conform to this
 * contract implicitly. External plugins must implement it explicitly.
 */
export interface EvePoller {
  /** Called once per daemon poll cycle. Returns number of items queued. */
  pollOnce(): Promise<number>;
  /** Optional cleanup on daemon shutdown. */
  shutdown?(): Promise<void>;
}
