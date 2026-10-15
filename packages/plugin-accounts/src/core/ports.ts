import type {
  OneTimeSecrets,
  OpaqueSecrets,
  PasswordHelper,
  PluginLimiter,
} from "@nextlyhq/plugin-sdk";

/**
 * What the accounts plugin borrows from core: the password, one-purpose
 * secret, opaque secret and limiter helpers core lends every plugin, in the
 * shapes the platform's sign-in design states for them. Every flow is written
 * against these shapes and nothing else, and `./adapter` is the one module
 * that finds them on the plugin context, so a move of where core hangs them
 * changes that module alone. Every one of them is the plugin SDK's own,
 * re-exported here.
 */

/**
 * Core's password hashing and rules, as the plugin SDK publishes them
 * (`ctx.security.passwords`).
 */
export type {
  PasswordCheck,
  PasswordHelper,
  PasswordRules,
} from "@nextlyhq/plugin-sdk";

/**
 * Core's one-purpose secrets (`ctx.security.secrets`) and opaque secrets
 * (`ctx.security.opaque`), as the plugin SDK publishes them.
 */
export type {
  OneTimeSecrets,
  OpaqueSecrets,
  SecretData,
  TxOption,
} from "@nextlyhq/plugin-sdk";

/**
 * Core's limiter and the rules a plugin declares for it, as the plugin SDK
 * publishes them (`ctx.limits`, `contributes.limits`).
 */
export type {
  AdmittedReservation,
  EntryVerdict,
  LimitCheck,
  LimitEntry,
  LimitOutcome,
  LimitReservation,
  LimitRule,
  LimitTarget,
  PluginLimiter,
} from "@nextlyhq/plugin-sdk";

/** Everything the plugin borrows from core's helpers. */
export interface AccountsCore {
  readonly passwords: PasswordHelper;
  readonly secrets: OneTimeSecrets;
  readonly opaque: OpaqueSecrets;
  readonly limits: PluginLimiter;
}
