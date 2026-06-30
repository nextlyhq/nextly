/**
 * Type-level test: the experimental auth surface is re-exported from the SDK
 * boundary (D71/D57). Checked by `tsc --noEmit` (check-types). Using each export
 * in a type position makes the compiler error if any is missing.
 */
import type {
  AuthInput,
  AuthOutcome,
  AuthStrategy,
  Challenge,
  ChallengeDefinition,
  AuthHooks,
  AuthHookName,
} from "@nextlyhq/plugin-sdk";

type _AuthSurface = [
  AuthInput,
  AuthOutcome,
  AuthStrategy,
  Challenge,
  ChallengeDefinition,
  AuthHooks,
  AuthHookName,
];

// Exercise the discriminated union so a regression in AuthOutcome surfaces here.
const _outcome: AuthOutcome = { type: "pass" };
void _outcome;
export type { _AuthSurface };
