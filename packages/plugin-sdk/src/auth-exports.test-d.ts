/**
 * Type-level test: the experimental auth surface is re-exported from the SDK
 * boundary (D71/D57). Checked by `tsc --noEmit` (check-types). Using each export
 * in a type position makes the compiler error if any is missing.
 */
import type {
  AuthInput,
  AuthLimitAnswer,
  AuthOutcome,
  AuthStrategy,
  Challenge,
  ChallengeDefinition,
  AuthHooks,
  AuthHookName,
} from "@nextlyhq/plugin-sdk";

type _AuthSurface = [
  AuthInput,
  AuthLimitAnswer,
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

// A strategy may answer the sign-in limiter, synchronously or not, and one
// written before it could still type-checks: the member is optional.
const _keyed: AuthStrategy = {
  name: "username",
  authenticate: () => Promise.resolve({ type: "pass" }),
  limitKey: ({ body }) =>
    typeof body.username === "string"
      ? { handles: true, key: body.username }
      : { handles: false },
};
const _unkeyed: AuthStrategy = {
  name: "legacy",
  authenticate: () => Promise.resolve({ type: "pass" }),
};
const _answer: Promise<AuthLimitAnswer> = Promise.resolve({
  handles: true,
  key: null,
});
void _keyed;
void _unkeyed;
void _answer;
export type { _AuthSurface };
