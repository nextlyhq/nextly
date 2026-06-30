import { NextlyError } from "../errors/nextly-error";

/**
 * Fail-fast boot error for plugin schema merging. Mirrors
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
 * exists in NEITHER the code/plugin merged schema NOR the Builder/UI set.
 * Since P8 turned on the Builder lane, a Builder-made target is resolved
 * — on the CLI against `ui-schema.json`, at runtime against the `dynamic_*`
 * tables — and no longer errors here; only a genuine typo (unknown everywhere)
 * does.
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
 * own field or one added by an earlier plugin's extend.
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

/**
 * Fail-fast boot error when a `relationTo` points at a slug that is not a
 * collection in the merged schema (nor a core target users/media).
 */
export function relationTargetMissingError(
  source: string,
  field: string,
  target: string
): NextlyError {
  return new NextlyError({
    code: "NEXTLY_SCHEMA_RELATION_TARGET_MISSING",
    statusCode: 400,
    publicMessage: "Schema configuration is invalid.",
    logMessage: `Field "${field}" on "${source}" has relationTo "${target}", which is not a collection in the merged schema`,
    logContext: { reason: "relation-target-missing", source, field, target },
  });
}

/**
 * Fail-fast boot error when a plugin's `.rename()` targets a slug it does not
 * contribute (a typo or stale rename).
 */
export function renameUnknownTargetError(
  target: string,
  owner: string
): NextlyError {
  return new NextlyError({
    code: "NEXTLY_SCHEMA_RENAME_UNKNOWN_TARGET",
    statusCode: 400,
    publicMessage: "Schema configuration is invalid.",
    logMessage: `Plugin "${owner}" renames "${target}", which is not one of its contributed collections/singles/components`,
    logContext: { reason: "rename-unknown-target", target, owner },
  });
}

/**
 * Fail-fast boot error when a plugin relates to another plugin's entity without
 * declaring `dependsOn` on it.
 */
export function crossPluginRelationError(
  sourcePlugin: string,
  targetPlugin: string,
  target: string
): NextlyError {
  return new NextlyError({
    code: "NEXTLY_SCHEMA_CROSS_PLUGIN_RELATION",
    statusCode: 409,
    publicMessage: "Schema configuration is invalid.",
    logMessage: `Plugin "${sourcePlugin}" relates to "${target}" owned by plugin "${targetPlugin}" but does not declare dependsOn["${targetPlugin}"]`,
    logContext: {
      reason: "cross-plugin-relation-missing-depends-on",
      sourcePlugin,
      targetPlugin,
      target,
    },
  });
}
