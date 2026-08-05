import { NextlyError } from "../errors/nextly-error";

/** Why a custom-permission declaration was rejected at boot. */
export type PermissionCollisionReason =
  | "duplicate-permission" // same (action, resource) declared by two sources
  | "system-resource-reserved" // resource is a built-in system resource
  | "crud-permission-reserved"; // duplicates an auto-seeded collection CRUD / single read-update

/**
 * Fail-fast boot error for an invalid plugin-declared custom permission.
 * Mirrors {@link ./schema-error}: the specific failure mode lives in
 * `logContext.reason`; the public message stays generic while the detail
 * (action/resource/owners) lives in `logContext` for operators.
 */
export function permissionCollisionError(
  action: string,
  resource: string,
  owners: string[],
  reason: PermissionCollisionReason
): NextlyError {
  return new NextlyError({
    code: "NEXTLY_PERMISSION_COLLISION",
    statusCode: 409,
    publicMessage: "Permission configuration is invalid.",
    logMessage: `Custom permission "${action}-${resource}" rejected (${reason}); declared by ${owners.join(" and ")}`,
    logContext: { reason, action, resource, owners },
  });
}

/**
 * Whether an error is a permission collision, for a caller deciding what to let through.
 *
 * Asked here rather than by comparing a code string at the catch site: the boot path forgives
 * failures that mean "the tables are not there yet", and a configuration collision must not be
 * forgiven with them. Two places comparing the same literal is how the thrower and the catcher
 * drift apart.
 */
export function isPermissionCollision(error: unknown): boolean {
  return (
    error instanceof NextlyError && error.code === "NEXTLY_PERMISSION_COLLISION"
  );
}
