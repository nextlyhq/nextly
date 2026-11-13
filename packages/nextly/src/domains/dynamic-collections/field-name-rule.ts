/**
 * What is wrong with a field's name, by the rule the Schema Builder's field save applies, for the
 * place the field sits: which kind of entity, whether at its top level or inside a group or a
 * repeater, and whether its publish lifecycle is on.
 *
 * One implementation for every asker. The save refuses a name through it, and the admin checks a
 * name as it is typed through it, so the panel can never accept a name the save then refuses, nor
 * refuse one the save would take. A copy kept in the admin would agree on the day it was written
 * and drift after, and the person would learn only at the save.
 *
 * Browser-safe on purpose: it reaches nothing that touches a database, so `nextly/config` can
 * offer it to the admin.
 *
 * @module domains/dynamic-collections/field-name-rule
 */
import {
  lifecycleDeclaredNameMessage,
  lifecycleReservesDeclaredName,
  reservedSystemFieldNames,
  systemColumnNames,
} from "../../lib/system-columns";
import { BUILDER_FIELD_NAME_RE } from "../../schemas/_zod/ui-schema";
import { toSnakeCase } from "../../shared/lib/case-conversion";

/** The kinds of entity whose fields the Schema Builder edits. */
export type FieldNameSurface = "collection" | "single" | "fieldGroup";

/**
 * Where a field's name is judged.
 *
 * @experimental Published for the Schema Builder's name checks.
 */
export interface FieldNamePlace {
  /**
   * The kind of entity the field belongs to. Absent, only the rules every kind shares are asked,
   * for a caller that does not say which entity it saves.
   */
  surface?: FieldNameSurface;
  /**
   * Inside a group or a repeater. Such a field is a key in its container's stored value, so the
   * rules about the entity's own columns and members do not reach it.
   */
  nested: boolean;
  /**
   * Whether the entity's Draft/Published lifecycle is on; only a collection and a Single have one.
   * Absent is off.
   */
  lifecycleEnabled?: boolean;
  /**
   * Whether the field becomes a column of the entity's table. A field-group reference, a
   * many-to-many relationship or a virtual field keeps its values elsewhere, so no column carries
   * its name and the column's length does not reach it. Absent is a column, the safe assumption
   * for a field whose storage is not known.
   */
  producesColumn?: boolean;
  /**
   * How a name may be spelled. `builder`, the default, is the snake case the Builder gives every
   * name it creates. `declared` also takes the camelCase a plugin or the API may declare, for the
   * roads that accept one.
   */
  spelling?: "builder" | "declared";
}

/** Which rule a name breaks. */
export type FieldNameProblemKind =
  | "spelling"
  | "column-too-long"
  | "reserved"
  | "lifecycle";

/**
 * Why a name cannot be used: the rule it breaks, the error code the save refuses it with, and a
 * message naming it.
 *
 * @experimental Published for the Schema Builder's name checks.
 */
export interface FieldNameProblem {
  kind: FieldNameProblemKind;
  code: "INVALID_FIELD_NAME" | "RESERVED";
  message: string;
}

/** The camelCase-tolerant spelling of the roads that take a declared name. */
const DECLARED_FIELD_NAME_RE = /^[a-z][a-zA-Z0-9_]*$/;

/**
 * The longest column every supported database keeps whole. PostgreSQL keeps 63 characters of an
 * identifier and MySQL 64: past that, MySQL refuses the column and PostgreSQL cuts the name, so two
 * names sharing their first 63 characters reach one column and the second cannot be added.
 */
export const MAX_FIELD_COLUMN_LENGTH = 63;

/**
 * The names every entity table carries as system columns (`id`, `created_at`, `updated_at`), in
 * both spellings. The same set the field-payload schema refuses at every depth, read from the one
 * declaration of system columns.
 */
const SYSTEM_FIELD_NAMES: ReadonlySet<string> = new Set(
  reservedSystemFieldNames("uiSchema")
);

/**
 * The columns only a collection's table carries (its owner column, `created_by`), in both
 * spellings. A Single or a field group has no such column, so the names are ordinary there.
 */
const COLLECTION_ONLY_FIELD_NAMES: ReadonlySet<string> = new Set(
  systemColumnNames(
    column =>
      column.presence === "always" &&
      column.appliesTo.includes("collection") &&
      !column.appliesTo.includes("single")
  )
);

/** Whether `name` is a collection's own system column, which its fields may not take. */
export function isCollectionOnlyFieldName(name: string): boolean {
  return COLLECTION_ONLY_FIELD_NAMES.has(name);
}

/** The problem for a name the field-payload schema reserves. */
function reservedProblem(name: string): FieldNameProblem {
  return {
    kind: "reserved",
    code: "RESERVED",
    message: `field name '${name}' is reserved`,
  };
}

/**
 * What is wrong with `name` at `place`, or `null` when nothing is.
 *
 * Asked of a name the save is about to create or rename to. A name the entity already holds at the
 * same place keeps working whatever this answers: a camelCase name a plugin declared, or a `status`
 * field saved before the lifecycle was turned on.
 *
 * The rules, in the order they are asked:
 * - the spelling (`^[a-z][a-z0-9_]*$` for a name the Builder creates);
 * - at the top level, for a field that becomes a column, one longer than every database keeps whole;
 * - a system column's name in either spelling (`id`, `created_at`, `updated_at`), at any depth;
 * - at a collection's top level, its owner column (`created_by`);
 * - at the top level of a collection or a Single whose lifecycle is on, the lifecycle's own names
 *   (`status`, `first_published_at`), which it declares itself.
 *
 * @experimental Published for the Schema Builder's name checks.
 */
export function fieldNameProblem(
  name: string,
  place: FieldNamePlace
): FieldNameProblem | null {
  const spelling =
    place.spelling === "declared"
      ? DECLARED_FIELD_NAME_RE
      : BUILDER_FIELD_NAME_RE;
  if (!spelling.test(name)) {
    return {
      kind: "spelling",
      code: "INVALID_FIELD_NAME",
      message: `field name must match ${spelling.source}`,
    };
  }
  // The column is the name in snake case, as every road writes it.
  if (
    !place.nested &&
    place.producesColumn !== false &&
    toSnakeCase(name).length > MAX_FIELD_COLUMN_LENGTH
  ) {
    return {
      kind: "column-too-long",
      code: "INVALID_FIELD_NAME",
      message: `field name '${name}' becomes a column longer than ${MAX_FIELD_COLUMN_LENGTH} characters, which the database cannot keep whole`,
    };
  }
  if (SYSTEM_FIELD_NAMES.has(name)) return reservedProblem(name);
  if (place.nested) return null;
  if (place.surface === "collection" && isCollectionOnlyFieldName(name)) {
    return reservedProblem(name);
  }
  // Only a collection and a Single have the lifecycle; a field group never does.
  if (
    (place.surface === "collection" || place.surface === "single") &&
    lifecycleOwns(name, place.surface, place)
  ) {
    return {
      kind: "lifecycle",
      code: "RESERVED",
      // The Builder saves its fields before its settings, so turning the lifecycle off in the same
      // save does not clear the way: the person saves that first.
      message:
        `${lifecycleDeclaredNameMessage(name)}. Turning it off takes a save of its own, before ` +
        "the field is added",
    };
  }
  return null;
}

/**
 * Whether the lifecycle owns the field's name: the declared name, the member it emits, and, for a
 * field that becomes a column, the column it reaches (`firstPublishedAt` reaches
 * `first_published_at`), as the code-first validators ask both.
 */
function lifecycleOwns(
  name: string,
  entity: "collection" | "single",
  place: FieldNamePlace
): boolean {
  const enabled = place.lifecycleEnabled === true;
  if (lifecycleReservesDeclaredName(name, entity, enabled)) return true;
  return (
    place.producesColumn !== false &&
    lifecycleReservesDeclaredName(toSnakeCase(name), entity, enabled)
  );
}
