/**
 * Dual-vocabulary resolution for field-group field types and references.
 *
 * ## Why this module exists
 *
 * Field groups were originally stored and declared with `type: "component"`.
 * As the product moved toward field-group vocabulary (`type: "fieldGroup"`),
 * databases and config files may carry either spelling.
 *
 * A field group stores its data in a dedicated relational table (`fg_<slug>` or
 * `comp_<slug>`) and must never produce a physical column on the parent collection
 * table (`dc_*`). A layer that only recognizes `"component"` treats `"fieldGroup"`
 * as an unknown scalar type, inadvertently allocating a text column on the parent table
 * and causing ghost column drops and Cartesian rename prompts during schema sync.
 *
 * This module centralizes dual-read resolution for field-group types and reference keys
 * so that both historical and target spellings resolve uniformly across DDL generators,
 * schema diffs, query/mutation services, and validators.
 *
 * @module domains/field-groups/storage/field-group-field-type
 */

import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import { MIGRATION_TARGET } from "../migration/target";

/** Historical field type tokens known to have been used in released configurations. */
const HISTORICAL_FIELD_GROUP_TYPES = ["component", "fieldGroup", "field-group"] as const;

/** Canonical set of recognized field-group type discriminators. */
export const fieldGroupFieldTypes: readonly string[] = Array.from(
  new Set([
    STORAGE_FORMAT.fieldType,
    MIGRATION_TARGET.fieldType,
    ...HISTORICAL_FIELD_GROUP_TYPES,
  ])
);

/** The default field type string used when emitting new definitions. */
export const currentFieldGroupFieldType = STORAGE_FORMAT.fieldType;

/**
 * Checks whether a given field type string represents a field group / component.
 *
 * Accepts both legacy `"component"` and current/future `"fieldGroup"` spellings.
 */
export function isFieldGroupType(type: unknown): boolean {
  if (typeof type !== "string") return false;
  return (
    type === STORAGE_FORMAT.fieldType ||
    type === MIGRATION_TARGET.fieldType ||
    type === "component" ||
    type === "fieldGroup" ||
    type === "field-group"
  );
}

/**
 * Checks whether a field definition represents a field group.
 */
export function isFieldGroupFieldDefinition(field: unknown): boolean {
  if (typeof field !== "object" || field === null) return false;
  const candidate = field as { type?: unknown };
  return isFieldGroupType(candidate.type);
}

/** Reference key resolution for single and polymorphic field-group slots. */
export interface ResolvedFieldGroupReferences {
  /** The single field group slug, if defined. */
  single?: string;
  /** The list of polymorphic field group slugs, if defined. */
  many?: string[];
}

/**
 * Extracts referenced field-group slug(s) from a field definition across both
 * component and fieldGroup property naming conventions.
 */
export function extractFieldGroupReferences(
  field: unknown
): ResolvedFieldGroupReferences {
  if (typeof field !== "object" || field === null) {
    return {};
  }
  const record = field as Record<string, unknown>;

  // Single reference: check component, fieldGroup, componentSlug
  let single: string | undefined;
  if (typeof record.component === "string" && record.component.trim().length > 0) {
    single = record.component.trim();
  } else if (typeof record.fieldGroup === "string" && record.fieldGroup.trim().length > 0) {
    single = record.fieldGroup.trim();
  } else if (typeof record.componentSlug === "string" && record.componentSlug.trim().length > 0) {
    single = record.componentSlug.trim();
  }

  // Multi reference: check components, fieldGroups
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
