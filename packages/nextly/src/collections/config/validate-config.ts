/**
 * Collection Configuration Validator
 *
 * Validates a {@link CollectionConfig} using shared base-validator helpers
 * for slug/field-name/relationship/select/component rules, plus the
 * collection-specific access control (create/read/update/delete) and
 * index validation that Singles/Components don't have.
 *
 * Duplicated validation logic was moved to `src/shared/base-validator.ts`
 * This file now orchestrates those helpers and keeps
 * only Collection-specific rules.
 *
 * @module collections/config/validate-config
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import { validateCollectionConfig } from '@nextly/core';
 *
 * const result = validateCollectionConfig(config, ['users', 'posts']);
 * if (!result.valid) {
 *   console.error('Validation errors:', result.errors);
 * }
 * ```
 */

import {
  COLLECTION_DB_OPTION_NAMES,
  COLLECTION_ID_TYPES,
} from "../../domains/collections/services/collection-db-options";
import { resolveLocalizedFieldNames } from "../../domains/i18n/classify-fields";
import { isPluginFieldTypeOnSurface } from "../../domains/schema/field-types/field-type-registry";
import {
  isManagedIndexName,
  resolveDeclaredIndexName,
} from "../../domains/schema/pipeline/diff/index-util";
import {
  fieldProducesColumn,
  toSnakeCase,
} from "../../domains/schema/services/field-column-descriptor";
import {
  isLifecycleSystemColumn,
  lifecycleDeclaredNameMessage,
  lifecycleReservesDeclaredName,
  isOwnableSystemColumn,
  isReservedSystemColumn,
} from "../../lib/system-columns";
import {
  NEWLY_RESERVED_SLUG_NOTES,
  SYSTEM_RESOURCES,
} from "../../schemas/_zod/rbac";
import {
  type BaseValidationError,
  DEFAULT_SQL_KEYWORDS_SET,
  validateComponentFieldRefShared,
  validateContainerFieldsShared,
  validateFieldTypeShared,
  validateNumberDecimalDimensionsShared,
  validateRelationshipTargetShared,
  validatePluginFieldOptionsShared,
  validateSelectOptionsShared,
  validateSlugShared,
  validateAccessShared,
  COLLECTION_ACCESS_KEYS,
  validateFieldBasicsShared,
} from "../../shared/base-validator";
import { isPlainObject } from "../../shared/lib/plain-copy";
// RESERVED_SLUGS and SQL_RESERVED_KEYWORDS used to live in this file. They
// moved to shared/sql-reserved.ts to break a circular dependency with
// base-validator. Imported here for local use in RESERVED_SLUGS_SET below
// and re-exported so existing consumers that import them from this file's
// path continue to work unchanged.
import {
  RESERVED_SLUGS,
  SQL_RESERVED_KEYWORDS,
} from "../../shared/sql-reserved";
// C7/D16 — accept plugin-registered custom field types (must be registered
// before the config is validated; see field-type-registry).

import type { CollectionConfig } from "./define-collection";

export { RESERVED_SLUGS, SQL_RESERVED_KEYWORDS };

// ============================================================
// Validation Error Types
// ============================================================

/**
 * Error codes for validation failures.
 * Used for programmatic error handling.
 */
export type ValidationErrorCode =
  // Slug errors
  | "SLUG_REQUIRED"
  | "SLUG_INVALID_TYPE"
  | "SLUG_TOO_SHORT"
  | "SLUG_TOO_LONG"
  | "SLUG_INVALID_FORMAT"
  | "SLUG_RESERVED"
  | "SLUG_SQL_KEYWORD"
  // Field errors
  | "FIELDS_REQUIRED"
  | "FIELDS_INVALID_TYPE"
  | "FIELDS_EMPTY"
  | "FIELD_NAME_REQUIRED"
  | "FIELD_NAME_INVALID_FORMAT"
  | "FIELD_NAME_SQL_KEYWORD"
  | "FIELD_NAME_DUPLICATE"
  | "FIELD_NAME_RESERVED"
  // A name that reaches a system column under a different spelling. Allowed only as the
  // column's own name, because the declared name stays the identity in every payload.
  | "FIELD_NAME_SYSTEM_ALIAS"
  // A name that reaches a column the Draft/Published lifecycle owns, while it is enabled.
  | "FIELD_NAME_LIFECYCLE_RESERVED"
  // A `status` choice longer than a version's status can record.
  | "FIELD_STATUS_OPTION_TOO_LONG"
  | "FIELD_TYPE_REQUIRED"
  | "FIELD_TYPE_INVALID"
  // A declared default the field's own rules reject.
  | "FIELD_DEFAULT_INVALID"
  // Field-specific errors
  | "SELECT_OPTIONS_REQUIRED"
  | "SELECT_OPTIONS_EMPTY"
  | "RADIO_OPTIONS_REQUIRED"
  | "RADIO_OPTIONS_EMPTY"
  | "RELATIONSHIP_TARGET_REQUIRED"
  | "RELATIONSHIP_TARGET_INVALID"
  | "RELATIONSHIP_TARGET_UNKNOWN"
  | "ARRAY_FIELDS_REQUIRED"
  | "GROUP_FIELDS_REQUIRED"
  | "DECIMAL_PRECISION_INVALID"
  | "DECIMAL_SCALE_INVALID"
  | "DECIMAL_SCALE_EXCEEDS_PRECISION"
  | "BLOCKS_REQUIRED"
  | "BLOCKS_EMPTY"
  | "BLOCK_SLUG_REQUIRED"
  | "BLOCK_FIELDS_REQUIRED"
  // Component field errors
  | "COMPONENT_REF_REQUIRED"
  | "COMPONENT_REF_CONFLICT"
  | "COMPONENT_REF_INVALID"
  | "COMPONENT_REF_EMPTY"
  // Access errors
  | "ACCESS_INVALID_TYPE"
  | "ACCESS_FUNCTION_INVALID"
  | "ACCESS_KEY_UNKNOWN"
  // Index errors
  | "INDEX_INVALID_TYPE"
  | "INDEX_FIELDS_REQUIRED"
  | "INDEX_FIELDS_EMPTY"
  | "INDEX_FIELD_UNKNOWN"
  | "INDEX_NAME_INVALID"
  // Database option errors
  | "DB_OPTIONS_INVALID_TYPE"
  | "DB_OPTION_UNKNOWN"
  | "DB_ID_TYPE_INVALID"
  | "DB_ALLOW_ID_ON_CREATE_INVALID";

/**
 * A single validation error with path and context.
 */
export interface ValidationError {
  /**
   * Dot-notation path to the invalid property.
   * @example 'slug', 'fields.0.name', 'fields.metadata.items.title'
   */
  path: string;

  /** Human-readable error message. */
  message: string;

  /** Machine-readable error code for programmatic handling. */
  code: ValidationErrorCode;
}

/**
 * Result of collection config validation.
 */
export interface ValidationResult {
  /** Whether the configuration is valid. */
  valid: boolean;

  /** Array of validation errors (empty if valid). */
  errors: ValidationError[];
}

// ============================================================
// Reserved Names and Keywords
// ============================================================

// RESERVED_SLUGS and SQL_RESERVED_KEYWORDS were defined here historically;
// they now live in shared/sql-reserved.ts and are re-exported above so the
// public API surface for this file is unchanged.

// System-resource names are added on top of the base reserved slugs. A
// collection named after a system resource would seed the same permission rows
// that resource's routes check (a `settings` collection reaches the user-fields
// and component admin surfaces, a `media` collection the media routes), so it is
// rejected here — at config validation, before any migration or table is built.
// The names are NOT in the shared base list, because that list also feeds the
// component validator and a component does not seed a permission under its slug.
const RESERVED_SLUGS_SET: Set<string> = new Set<string>([
  ...RESERVED_SLUGS,
  ...SYSTEM_RESOURCES,
]);

// System columns injected onto a collection table, under both the snake_case
// name and the camelCase alias that snake-cases to the same column. A code-first
// collection must not declare a top-level field with either name, or its DDL
// would collide with the injected column and the system's own stamp would
// consume a user field.
//
// `created_by` is the owner column. `first_published_at` records the first
// transition into published; it is injected only when the draft/publish
// lifecycle is enabled, but it is reserved unconditionally, because a
// collection can enable that lifecycle later and the field would collide the
// moment it did — failing at migration time rather than at config validation,
// which is much further from the mistake.
//
// Components embed in JSON and carry neither column, so they may use both names
// freely. Nested repeater/group fields are stored inside JSON, not as table
// columns, so the reservation applies to the top level only.

// ============================================================
// Index Validation (collection-specific)
// ============================================================

/**
 * Regex pattern for valid index names.
 * Must be alphanumeric with underscores, starting with a letter.
 */
const INDEX_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*$/;

/**
 * Validates the indexes configuration.
 */
/** The longest status a version can record (the versions table's `status` column). */
const STATUS_OPTION_MAX_LENGTH = 32;

/**
 * The refusal for a `status` choice field with an option longer than a version's status can
 * record, or null. Shared by the collection and Single validators, so both refuse it in one
 * sentence.
 */
export function statusOptionError(
  column: string,
  field: Record<string, unknown>,
  path: string
): {
  path: string;
  message: string;
  code: "FIELD_STATUS_OPTION_TOO_LONG";
} | null {
  if (column !== "status") return null;
  const tooLong = statusOptionTooLong(field);
  if (tooLong === null) return null;
  return {
    path,
    message: `The status option '${tooLong}' is ${tooLong.length} characters; a status holds at most ${STATUS_OPTION_MAX_LENGTH}. Shorten its value (its label can stay as long as you like)`,
    code: "FIELD_STATUS_OPTION_TOO_LONG",
  };
}

/**
 * The first option value of a select or radio field that is longer than a status can be, or null.
 * Other field types declare no values, and a free-text status is shortened where it is recorded.
 */
function statusOptionTooLong(field: Record<string, unknown>): string | null {
  if (field.type !== "select" && field.type !== "radio") return null;
  if (!Array.isArray(field.options)) return null;
  const values = (field.options as unknown[]).map(optionValue);
  return values.find(value => value.length > STATUS_OPTION_MAX_LENGTH) ?? null;
}

/** An option's stored value: the option itself when a string, else its `value`. */
function optionValue(option: unknown): string {
  if (typeof option === "string") return option;
  const value = (option as { value?: unknown } | null)?.value;
  return typeof value === "string" ? value : "";
}

function validateIndexes(
  indexes: unknown,
  fields: unknown[],
  collectionLocalized: boolean,
  errors: ValidationError[]
): void {
  if (!indexes) {
    return;
  }

  if (!Array.isArray(indexes)) {
    errors.push({
      path: "indexes",
      message: "Indexes must be an array",
      code: "INDEX_INVALID_TYPE",
    });
    return;
  }

  // Names are resolved by the schema build's own rule, so a name accepted here
  // is one every push and migration can build. A field without a string name
  // and type cannot be resolved; field validation reports it.
  const namedFields = fields.filter(
    (field): field is { name: string; type: string; options?: unknown } =>
      typeof field === "object" &&
      field !== null &&
      typeof (field as { name?: unknown }).name === "string" &&
      typeof (field as { type?: unknown }).type === "string"
  );
  const localizedNames = new Set(
    collectionLocalized ? resolveLocalizedFieldNames(namedFields, true) : []
  );

  indexes.forEach((index, idx) => {
    const indexPath = `indexes[${idx}]`;

    if (!index || typeof index !== "object") {
      errors.push({
        path: indexPath,
        message: "Each index must be an object",
        code: "INDEX_INVALID_TYPE",
      });
      return;
    }

    const i = index as Record<string, unknown>;

    if (!i.fields) {
      errors.push({
        path: `${indexPath}.fields`,
        message: "Index must specify 'fields' array",
        code: "INDEX_FIELDS_REQUIRED",
      });
      return;
    }

    if (!Array.isArray(i.fields)) {
      errors.push({
        path: `${indexPath}.fields`,
        message: "Index 'fields' must be an array",
        code: "INDEX_FIELDS_REQUIRED",
      });
      return;
    }

    if (i.fields.length === 0) {
      errors.push({
        path: `${indexPath}.fields`,
        message: "Index must specify at least one field",
        code: "INDEX_FIELDS_EMPTY",
      });
      return;
    }

    i.fields.forEach((fieldName, fieldIdx) => {
      if (typeof fieldName !== "string") {
        errors.push({
          path: `${indexPath}.fields[${fieldIdx}]`,
          message: "Index field must be a string",
          code: "INDEX_FIELD_UNKNOWN",
        });
        return;
      }

      const target = resolveDeclaredIndexName(
        fieldName,
        namedFields,
        localizedNames
      );
      if (target.kind === "refused") {
        errors.push({
          path: `${indexPath}.fields[${fieldIdx}]`,
          message: target.message,
          code: "INDEX_FIELD_UNKNOWN",
        });
      }
    });

    if (i.name !== undefined) {
      if (typeof i.name !== "string") {
        errors.push({
          path: `${indexPath}.name`,
          message: "Index name must be a string",
          code: "INDEX_NAME_INVALID",
        });
      } else if (!INDEX_NAME_PATTERN.test(i.name)) {
        errors.push({
          path: `${indexPath}.name`,
          message: `Invalid index name '${i.name}'. Must start with a letter and contain only letters, numbers, and underscores`,
          code: "INDEX_NAME_INVALID",
        });
      } else if (!isManagedIndexName(i.name)) {
        // The schema diff matches an index by its columns, but drops only the
        // names it owns: a live index under any other name may be one a
        // database administrator added, and is left alone. A declared index
        // named outside the prefixes would be created and then never removed
        // when the declaration is, so the name is refused where the
        // collection is defined rather than when its schema is first pushed.
        const prefix = i.unique === true ? "uq_" : "idx_";
        errors.push({
          path: `${indexPath}.name`,
          message: `Index name '${i.name}' must start with "idx_" or "uq_", the names schema changes manage. Rename it (for example '${prefix}${i.name}') or leave 'name' out to have one derived.`,
          code: "INDEX_NAME_INVALID",
        });
      }
    }

    if (i.unique !== undefined && typeof i.unique !== "boolean") {
      errors.push({
        path: `${indexPath}.unique`,
        message: "Index 'unique' must be a boolean",
        code: "INDEX_INVALID_TYPE",
      });
    }
  });
}

// ============================================================
// Field Validation (orchestrates shared helpers)
// ============================================================

/**
 * Validate a single field configuration recursively.
 *
 * Dispatches to shared helpers for name/type/relationship/select/component
 * rules, and recurses into `repeater`/`group` children.
 */
function validateField(
  field: unknown,
  path: string,
  errors: ValidationError[],
  seenNames: Set<string>,
  allCollectionSlugs?: string[]
): void {
  if (!field || typeof field !== "object") {
    return;
  }

  const f = field as Record<string, unknown>;
  const errsBase = errors as unknown as BaseValidationError[];

  // Plugin types are accepted only when they opted into the entries surface —
  // registration alone is not authorization for a collection field.
  // Whether a name is usable as a column does not depend on the field's type,
  // and a contributed type has no answer here at all — it defers to boot. Left
  // behind the type check, a plugin field's name was never checked by anything:
  // the deferral returns before this, and the boot gate asks only whether the
  // token was claimed. A duplicate or SQL-reserved name reached schema
  // generation as a colliding column.
  validateFieldBasicsShared(f, path, errsBase, seenNames);

  if (
    !validateFieldTypeShared(f.type, path, errsBase, type =>
      isPluginFieldTypeOnSurface(type, "entries")
    )
  ) {
    return;
  }
  const fieldType = f.type as string;

  // A plugin type reaches none of the cases below, so its own declaration
  // checks run here rather than as a case that could never be written for a
  // type core does not know.
  validatePluginFieldOptionsShared(f, path, errsBase);

  switch (fieldType) {
    case "select":
      validateSelectOptionsShared(f, path, errsBase, "select");
      break;

    case "radio":
      validateSelectOptionsShared(f, path, errsBase, "radio");
      break;

    case "blocks":
      // A blocks default must satisfy the same field policy the write applies.
      break;

    case "relationship":
      validateRelationshipTargetShared(f, path, errsBase, allCollectionSlugs);
      break;

    case "repeater":
      validateContainerFieldsShared(
        f,
        path,
        errsBase,
        { label: "Array field", code: "ARRAY_FIELDS_REQUIRED" },
        (children, basePath) =>
          validateFieldsArray(children, basePath, errors, allCollectionSlugs)
      );
      break;

    case "group":
      validateContainerFieldsShared(
        f,
        path,
        errsBase,
        { label: "Group field", code: "GROUP_FIELDS_REQUIRED" },
        (children, basePath) =>
          validateFieldsArray(children, basePath, errors, allCollectionSlugs)
      );
      break;

    case "component":
    case "fieldGroup":
      // The migrated spelling validates by the same reference rule.
      validateComponentFieldRefShared(f, path, errsBase);
      break;

    case "number":
      validateNumberDecimalDimensionsShared(f, path, errsBase);
      break;
  }
}

/**
 * Validate an array of field configurations.
 */
function validateFieldsArray(
  fields: unknown[],
  basePath: string,
  errors: ValidationError[],
  allCollectionSlugs?: string[]
): void {
  const seenNames = new Set<string>();

  fields.forEach((field, index) => {
    const fieldPath = `${basePath}[${index}]`;
    validateField(field, fieldPath, errors, seenNames, allCollectionSlugs);
  });
}

/**
 * Validate the top-level fields array.
 */
function validateFields(
  fields: unknown,
  errors: ValidationError[],
  allCollectionSlugs?: string[],
  lifecycleEnabled = false
): void {
  const path = "fields";

  if (!fields) {
    errors.push({
      path,
      message: "Collection fields are required",
      code: "FIELDS_REQUIRED",
    });
    return;
  }

  if (!Array.isArray(fields)) {
    errors.push({
      path,
      message: "Collection fields must be an array",
      code: "FIELDS_INVALID_TYPE",
    });
    return;
  }

  if (fields.length === 0) {
    errors.push({
      path,
      message: "Collection must have at least one field",
      code: "FIELDS_EMPTY",
    });
    return;
  }

  // Block names that become a column the table already carries. Such a field is emitted alongside
  // the injected one, so the table declares the column twice and the database refuses the
  // statement — a collection carrying one could never have been created.
  //
  // Compared as the PHYSICAL column, through the same conversion schema generation uses, because a
  // field name reaches its column that way: `createdAt`, `created_at` and `CreatedAt` all arrive at
  // `created_at`, and a set of literal spellings can only hold the ones somebody listed.
  //
  // `title`, `slug` and `status` are deliberately absent. The first two step aside for an author's
  // own field by design, and a `status` field is accepted by the lifecycle rather than duplicated;
  // reserving any of them would refuse a configuration that works today.
  //
  // Nested fields are validated recursively inside validateFieldsArray and are intentionally
  // exempt: they are stored inside JSON and never become columns of their own.
  //
  // Ownership is GLOBAL, not per table. Two names that reach one column are refused even when the
  // generators would put them in different tables — a shared `foo_bar` beside a localized
  // `FooBar`. Physical separation does not keep the two values apart, because the write path
  // normalizes payload keys through the same conversion BEFORE it splits localized fields off:
  //
  //   for (const [key, value] of Object.entries(rawEntryData))
  //     entryData[toSnakeCase(key)] = value;
  //
  // Both keys land on `foo_bar` and the second silently overwrites the first, so one of the two
  // authored values is already gone by the time anything decides which table it belongs to.
  const columnOwners = new Map<string, string>();
  fields.forEach((field, index) => {
    if (!field || typeof field !== "object") return;
    const candidate = field as Record<string, unknown>;
    const name = candidate.name;
    if (typeof name !== "string") return;
    const column = toSnakeCase(name);
    if (isReservedSystemColumn(column, "collectionConfig")) {
      errors.push({
        path: `${path}[${index}].name`,
        message: `Field name '${name}' is reserved: it becomes the system column '${column}'`,
        code: "FIELD_NAME_RESERVED",
      });
      return;
    }
    // Everything below is about columns, so a field that occupies none is exempt. A component or
    // a many-to-many named `Title` takes over nothing: its values live in its own table and its
    // payload key stays `Title`, distinct from the system field's `title`.
    if (lifecycleReservesDeclaredName(name, "collection", lifecycleEnabled)) {
      errors.push({
        path: `${path}[${index}].name`,
        message: lifecycleDeclaredNameMessage(name),
        code: "FIELD_NAME_LIFECYCLE_RESERVED",
      });
      return;
    }
    if (!fieldProducesColumn(candidate)) return;
    // A field may take over `title` or `slug` — that is the documented "user wins" behaviour —
    // but only under the column's own name. `Title` reaches the same column while staying a
    // different identity everywhere the declared name is the key: the runtime table's property,
    // the payload keys a mutation generates, the response document, the generated types. The two
    // would then write one column under two names, and the generated value would overwrite the
    // author's. Refused here, with the spelling that works, rather than normalized at every layer.
    if (column !== name && isOwnableSystemColumn(column, "collection")) {
      errors.push({
        path: `${path}[${index}].name`,
        message: `Field name '${name}' becomes the system column '${column}'. Name the field '${column}' to replace that column, or choose a different name`,
        code: "FIELD_NAME_SYSTEM_ALIAS",
      });
      return;
    }
    // The Draft/Published lifecycle owns its columns outright: their length, their NOT NULL, the
    // 'draft' default and the values publish/unpublish write. An author's field cannot stand in
    // for one, so any name reaching them is a collision rather than a takeover, and the table
    // would declare the column twice. Only when the lifecycle is on — with it off these are
    // ordinary names and a `status` field is measured clean in all three generators.
    if (lifecycleEnabled && isLifecycleSystemColumn(column, "collection")) {
      errors.push({
        path: `${path}[${index}].name`,
        message: `Field name '${name}' becomes the column '${column}', which the Draft/Published lifecycle owns. Rename the field, or turn the lifecycle off`,
        code: "FIELD_NAME_LIFECYCLE_RESERVED",
      });
      return;
    }
    // Without the lifecycle, a field named `status` is what each version records as its status
    // (see `domains/versions/recorded-status`), and a version's status holds 32 characters. A
    // choice field declares every value it can hold, so a longer option is refused here, where it
    // is written, rather than shortened in history on every save that picks it.
    const statusError = statusOptionError(
      column,
      candidate,
      `${path}[${index}].options`
    );
    if (statusError !== null) {
      errors.push(statusError);
      return;
    }
    // Two names that reach one column cannot both be emitted, so the table could never be
    // created. Checked here rather than in the shared field-name rule because only this level has
    // columns at all: a repeater or group keeps its children inside a single JSON column, where
    // two names that convert alike are simply two keys.
    //
    // Column-less field types are exempt for the same reason. A component and a many-to-many
    // relationship store their values in their own tables, keyed by the field's declared name, so
    // two of them whose names converge stay distinct and nothing is emitted twice.
    const owner = columnOwners.get(column);
    if (owner !== undefined) {
      errors.push({
        path: `${path}[${index}].name`,
        message: `Field name '${name}' collides with '${owner}': both become the column '${column}'`,
        code: "FIELD_NAME_DUPLICATE",
      });
      return;
    }
    columnOwners.set(column, name);
  });

  validateFieldsArray(fields, path, errors, allCollectionSlugs);
}

/**
 * Validates access control functions through the shared rule, with the keys
 * this entity supports.
 */
function validateAccess(access: unknown, errors: ValidationError[]): void {
  validateAccessShared(access, COLLECTION_ACCESS_KEYS, errors);
}

/**
 * Validates the collection's `db` options where they are written.
 *
 * The write path reads them leniently: an `idType` it does not recognise
 * generates UUIDv4 ids, and an `allowIdOnCreate` that is not `true` discards
 * every id a caller supplies, and it reads no other name at all. Unchecked, a
 * misspelt value or a misspelt name would be ignored in silence. `serial`
 * gets its own message because it is the value a config carried over from
 * Payload holds, and it is deliberately not offered.
 */
function validateDbOptions(db: unknown, errors: ValidationError[]): void {
  if (db === undefined) return;
  if (!isPlainObject(db)) {
    errors.push({
      path: "db",
      code: "DB_OPTIONS_INVALID_TYPE",
      message: "Collection db options must be an object.",
    });
    return;
  }
  errors.push(...unknownDbOptionErrors(db));
  const offered: readonly unknown[] = COLLECTION_ID_TYPES;
  if (db.idType !== undefined && !offered.includes(db.idType)) {
    errors.push({
      path: "db.idType",
      code: "DB_ID_TYPE_INVALID",
      message: idTypeRefusal(db.idType),
    });
  }
  if (
    db.allowIdOnCreate !== undefined &&
    typeof db.allowIdOnCreate !== "boolean"
  ) {
    errors.push({
      path: "db.allowIdOnCreate",
      code: "DB_ALLOW_ID_ON_CREATE_INVALID",
      message: "db.allowIdOnCreate must be true or false.",
    });
  }
}

/** A refusal for each name in `db` that is not an option. */
function unknownDbOptionErrors(db: Record<string, unknown>): ValidationError[] {
  const known: readonly string[] = COLLECTION_DB_OPTION_NAMES;
  const names = COLLECTION_DB_OPTION_NAMES.map(name => `"${name}"`).join(", ");
  return Object.keys(db)
    .filter(name => !known.includes(name))
    .map(name => ({
      path: `db.${name}`,
      code: "DB_OPTION_UNKNOWN" as const,
      message: `"${name}" is not a collection db option; the options are ${names}.`,
    }));
}

/** Why an `idType` outside the offered set is refused, and what to use. */
function idTypeRefusal(idType: unknown): string {
  const choices = COLLECTION_ID_TYPES.map(t => `"${t}"`).join(" or ");
  if (idType === "serial") {
    return `db.idType "serial" is not offered: a collection's id is text, which every relation and API path reads. For a sequential number, such as an order number, declare a table keyed by col.serial(). Use ${choices} here.`;
  }
  // A string is shown in quotes; anything else by its kind, which cannot
  // throw the way serialising a bigint would.
  const shown =
    typeof idType === "string" ? `"${idType}"` : `a ${typeof idType}`;
  return `db.idType must be ${choices}; got ${shown}.`;
}

// ============================================================
// Main Validation Function
// ============================================================

/**
 * Validates a complete collection configuration.
 *
 * Performs comprehensive validation including slug format/reserved names,
 * SQL keyword blocking, recursive field validation, select options,
 * relationship targets (optionally cross-checked against known collection
 * slugs), duplicate detection, access function types, index
 * configuration validation, and the `db` options.
 *
 * @param config - The collection configuration to validate
 * @param allCollectionSlugs - Optional array of all collection slugs for relationship validation
 * @returns Validation result with any errors found
 *
 * @example
 * ```typescript
 * import { validateCollectionConfig } from '@nextly/core';
 *
 * const result = validateCollectionConfig(config, ['users', 'posts', 'categories']);
 *
 * if (!result.valid) {
 *   result.errors.forEach(err => {
 *     console.error(`[${err.code}] ${err.path}: ${err.message}`);
 *   });
 * }
 * ```
 */
export function validateCollectionConfig(
  config: CollectionConfig,
  allCollectionSlugs?: string[]
): ValidationResult {
  const errors: ValidationError[] = [];
  const errsBase = errors as unknown as BaseValidationError[];

  validateSlugShared(config.slug, errsBase, {
    entityLabel: "Collection",
    reservedSlugsSet: RESERVED_SLUGS_SET,
    reservedSlugNotes: NEWLY_RESERVED_SLUG_NOTES,
    sqlKeywordsSet: DEFAULT_SQL_KEYWORDS_SET,
  });

  validateFields(
    config.fields,
    errors,
    allCollectionSlugs,
    (config as { status?: boolean }).status === true
  );

  validateIndexes(
    config.indexes,
    config.fields,
    config.localized === true,
    errors
  );

  validateAccess(config.access, errors);

  validateDbOptions(config.db, errors);

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Throws an error if the configuration is invalid.
 *
 * Convenience wrapper around {@link validateCollectionConfig}.
 */
export function assertValidCollectionConfig(
  config: CollectionConfig,
  allCollectionSlugs?: string[]
): void {
  const result = validateCollectionConfig(config, allCollectionSlugs);

  if (!result.valid) {
    const errorMessages = result.errors
      .map(err => `  - [${err.code}] ${err.path}: ${err.message}`)
      .join("\n");

    throw new Error(
      `Invalid collection config for '${config.slug || "unknown"}':\n${errorMessages}`
    );
  }
}
