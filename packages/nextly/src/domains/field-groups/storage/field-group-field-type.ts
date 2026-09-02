/**
 * The two spellings a stored field definition may use for a field group, and
 * the reference keys it may point at it with.
 *
 * ## Why this module exists
 *
 * Every database shipped so far declares a field group as `type: "component"`;
 * `schemas/storage-format.ts` owns that spelling. The storage migration moves
 * the token to `type: "fieldGroup"`, and `field-groups/migration/target.ts`
 * conditions that move on every reader accepting both spellings first. A reader
 * that recognises only `"component"` reads a migrated definition as an unknown
 * type — and an unknown type counts as a column-producing one, so the parent
 * collection table grows a text column the declared schema never asks for. The
 * next schema sync then offers to drop that ghost column, which is the startup
 * rename prompt this module exists to prevent.
 *
 * Every check that decides whether a field is a field group — column
 * production, schema diff, query filters, reference collection, sanitisation —
 * asks `isFieldGroupType` rather than comparing either constant directly, so
 * two layers cannot disagree about the same stored definition.
 *
 * @module domains/field-groups/storage/field-group-field-type
 */

import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import { MIGRATION_TARGET } from "../migration/target";

/**
 * Every field type token a stored definition may carry for a field group: the
 * spelling on disk today and the one the storage migration moves it to.
 */
export const fieldGroupFieldTypes: readonly string[] = [
  STORAGE_FORMAT.fieldType,
  MIGRATION_TARGET.fieldType,
];

/**
 * Whether a field type token names a field group, in either the current or the
 * migrated spelling. Anything else — including the kebab-cased
 * `"field-group"`, which no release ever wrote — is not a field group here.
 */
export function isFieldGroupType(type: unknown): boolean {
  return typeof type === "string" && fieldGroupFieldTypes.includes(type);
}

/** Reference key resolution for single and polymorphic field-group slots. */
export interface ResolvedFieldGroupReferences {
  /** The single field group slug, if defined. */
  single?: string;
  /** The list of polymorphic field group slugs, if defined. */
  many?: string[];
}

/**
 * Extracts the field-group slug(s) a field definition points at.
 *
 * Reads all the reference keys storage has ever used or is scheduled to use:
 * `component` / `components` today, `fieldGroup` / `fieldGroups` once the
 * migration moves the keys, and the retired `componentSlug`, which old rows may
 * still carry. A definition names at most one shape; where several keys are
 * present the current spelling wins over the future one, and the future one
 * over the retired one.
 */
export function extractFieldGroupReferences(
  field: unknown
): ResolvedFieldGroupReferences {
  if (typeof field !== "object" || field === null) {
    return {};
  }
  const record = field as Record<string, unknown>;

  let single: string | undefined;
  if (
    typeof record.component === "string" &&
    record.component.trim().length > 0
  ) {
    single = record.component.trim();
  } else if (
    typeof record.fieldGroup === "string" &&
    record.fieldGroup.trim().length > 0
  ) {
    single = record.fieldGroup.trim();
  } else if (
    typeof record.componentSlug === "string" &&
    record.componentSlug.trim().length > 0
  ) {
    single = record.componentSlug.trim();
  }

  let many: string[] | undefined;
  if (Array.isArray(record.components)) {
    const list = record.components.filter(
      (s): s is string => typeof s === "string" && s.trim().length > 0
    );
    if (list.length > 0) many = list;
  } else if (Array.isArray(record.fieldGroups)) {
    const list = record.fieldGroups.filter(
      (s): s is string => typeof s === "string" && s.trim().length > 0
    );
    if (list.length > 0) many = list;
  }

  return { single, many };
}
