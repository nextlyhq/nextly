/**
 * Auth extensibility pipeline (D71/D57) — barrel.
 *
 * Contract types now; runtime exports (strategy chain, hook registry, challenge
 * registry, pending-token helpers) are added as the pipeline is built.
 */
export type {
  AuthInput,
  AuthOutcome,
  AuthStrategy,
  Challenge,
  ChallengeDefinition,
  AuthHooks,
  AuthHookName,
} from "./types";
