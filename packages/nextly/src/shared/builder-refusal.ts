/**
 * The schema builder is off in production, whatever the configuration says: schema reaches
 * production only through migrations.
 *
 * This module owns that rule for every way of changing schema while a server runs: whether the
 * server runs in production, the refusal each such change meets there, and the line a production
 * start logs when the configuration asks for the builder anyway. The admin API's routes ask it
 * through `builder-access.ts`, which adds the `showBuilder` setting outside production; the
 * schema saves made in code (the Direct API's field groups, a plugin's collection service) ask it
 * directly, since `showBuilder` is an admin setting and does not reach them.
 *
 * It imports nothing from the route handler or the service container, so every one of those can
 * import it.
 */

import { NextlyError } from "../errors/nextly-error";

/**
 * Whether this process runs in production, from `NODE_ENV` as it is at the call.
 *
 * Read live rather than through the validated `env` object, which is read once and cached: the
 * runtime value is what the server runs under, and a test that switches it sees each switch.
 */
export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Why the builder is off: in production, or turned off by `admin.branding.showBuilder: false`.
 * The two refusals tell the reader different things, since only the second has a switch.
 */
export type BuilderOffReason = "production" | "turned-off";

const REFUSALS: Record<BuilderOffReason, string> = {
  production:
    "The schema builder is off in production. Make schema changes in development and deploy them as a migration.",
  "turned-off":
    "The schema builder is turned off by admin.branding.showBuilder. Define schema in code, or set showBuilder to true to turn it on.",
};

/**
 * The refusal for a builder-only operation while the builder is off.
 *
 * Distinct from a permission failure: the caller may well be a super-admin.
 * The environment, not the user, is what forbids this — so it carries its own
 * code, and its message says what to do instead for the reason it is off.
 *
 * @param operation - Operation name for the log, e.g. "create-collection".
 * @param reason - Why the builder is off.
 */
export function builderDisabledError(
  operation: string,
  reason: BuilderOffReason
): NextlyError {
  return new NextlyError({
    code: "BUILDER_DISABLED",
    publicMessage: REFUSALS[reason],
    logContext: { operation, reason, nodeEnv: process.env.NODE_ENV },
  });
}

/**
 * Throw when a schema save made in code (the Direct API, a plugin's collection service) runs in
 * production, with the builder's own refusal: such a save writes the same definition as the
 * builder's, and schema reaches production only through migrations.
 *
 * Production alone decides it. `showBuilder` is an admin setting, so a save made in code during
 * development goes ahead whatever it says.
 *
 * @param operation - Operation name for the log, e.g. "fieldGroups.create".
 */
export function refuseSchemaChangeInProduction(operation: string): void {
  if (isProductionRuntime()) {
    throw builderDisabledError(operation, "production");
  }
}

/**
 * The line a production start logs when the configuration sets `showBuilder: true`, which has no
 * effect there; `null` when none is owed. A pure function of the configuration, so the start that
 * logs it writes nothing for it.
 *
 * @param config - The configuration the server starts with.
 * @param production - Whether the server is starting in production.
 */
export function showBuilderProductionNotice(
  config: unknown,
  production: boolean
): string | null {
  if (!production) return null;
  const showBuilder = (
    config as { admin?: { branding?: { showBuilder?: unknown } } } | null
  )?.admin?.branding?.showBuilder;
  if (showBuilder !== true) return null;
  return "admin.branding.showBuilder: true has no effect in production: the schema builder is off here, and schema reaches production through migrations (nextly migrate).";
}
