import { NextlyError } from "../errors/nextly-error";

/**
 * Fail-fast boot error for plugin schema merging (D13). Mirrors
 * {@link ./resolution-error}: the specific failure mode is carried in
 * `logContext.reason`; the public message stays generic while the detail
 * (kind/slug/owners) lives in `logContext` for operators.
 */
export function slugCollisionError(
  kind: "collection" | "single" | "component",
  slug: string,
  owners: string[]
): NextlyError {
  return new NextlyError({
    code: "NEXTLY_SCHEMA_SLUG_COLLISION",
    statusCode: 409,
    publicMessage: "Schema configuration is invalid.",
    logMessage: `Duplicate ${kind} slug "${slug}" contributed by ${owners.join(" and ")}`,
    logContext: { reason: "slug-collision", kind, slug, owners },
  });
}

/**
 * Fail-fast boot error when a plugin's `contributes.extend` targets a slug that
 * is not in the merged schema (D12). This is also how extending a Builder-only
 * entity fails loud during the code-first-only gap (R2): Builder entities are
 * not in the code-first merged config, so they read as unknown targets here.
 */
export function extendTargetUnknownError(
  target: string,
  owner: string
): NextlyError {
  return new NextlyError({
    code: "NEXTLY_SCHEMA_EXTEND_TARGET_UNKNOWN",
    statusCode: 400,
    publicMessage: "Schema configuration is invalid.",
    logMessage: `Plugin "${owner}" extends unknown entity "${target}" (not a code-first or plugin collection/single/component in the merged schema)`,
    logContext: { reason: "extend-target-unknown", target, owner },
  });
}

/**
 * Fail-fast boot error when a plugin's `contributes.extend` adds a field whose
 * name already exists on the target (case-insensitive) — either the target's
 * own field or one added by an earlier plugin's extend (D13).
 */
export function extendFieldDuplicateError(
  target: string,
  field: string,
  owner: string
): NextlyError {
  return new NextlyError({
    code: "NEXTLY_SCHEMA_EXTEND_FIELD_DUPLICATE",
    statusCode: 409,
    publicMessage: "Schema configuration is invalid.",
    logMessage: `Plugin "${owner}" extends "${target}" with a duplicate field "${field}"`,
    logContext: { reason: "extend-field-duplicate", target, field, owner },
  });
}
