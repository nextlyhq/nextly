/**
 * Base Validator
 *
 * Shared validation helpers used by the Collection, Single, and Component
 * config validators. Extracts duplicated logic for slug/field-name checks,
 * select-option validation, relationship target validation, component
 * reference validation, and recursive field walking.
 *
 * Each of the three domain validators (validate-config, validate-single,
 * validate-component) used to carry its own copy of this logic. They now
 * orchestrate validation by calling into these shared helpers and only
 * keep their domain-specific rules (access rules, indexes, nesting depth).
 *
 * The helpers are intentionally agnostic about the exact error-code union
 * used by each domain — they push errors using the shared
 * {@link BaseValidationError} shape, which domain error types structurally
 * extend. Callers may pass their own typed error array via a narrow cast.
 *
 * @module shared/base-validator
 * @since 1.0.0
 */

import {
  RESERVED_SLUGS,
  SQL_RESERVED_KEYWORDS,
} from "../collections/config/validate-config";

// ============================================================
// Shared Types
// ============================================================

/**
 * Base shape of a validation error. Domain validators extend this shape
 * with a narrower `code` union (e.g., `SingleValidationErrorCode`).
 * Helpers in this module push errors using this base shape; domain call
 * sites cast their typed array to `BaseValidationError[]` when invoking.
 */
export interface BaseValidationError {
  /** Dot-notation path to the invalid property (e.g., "fields[0].name"). */
  path: string;

  /** Human-readable error message. */
  message: string;

  /** Machine-readable error code. */
  code: string;
}

/**
 * Parameter bundle for {@link validateSlugShared}.
 *
 * `entityLabel` is injected into error messages (e.g., "Single", "Collection").
 * `reservedSlugsSet` and `sqlKeywordsSet` are the Sets of disallowed names.
 */
export interface SlugValidationContext {
  /** Human label for error messages — "Single", "Collection", "Component". */
  entityLabel: string;

  /** Reserved slugs (Set for O(1) lookup). */
  reservedSlugsSet: Set<string>;

  /** SQL keywords (Set for O(1) lookup). */
  sqlKeywordsSet: Set<string>;
}

// ============================================================
// Shared Constants
// ============================================================

/**
 * Regex pattern for valid slugs.
 * Must start with a lowercase letter, contain only lowercase letters,
 * numbers, hyphens, and underscores. Length: 1-50 chars.
 */
export const SLUG_PATTERN = /^[a-z][a-z0-9_-]*$/;

/**
 * Regex pattern for valid field names.
 * Must start with a letter (upper or lower), contain only letters,
 * numbers, and underscores. Supports camelCase.
 */
export const FIELD_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*$/;

/**
 * All valid field types in Nextly.
 * Shared across every domain validator — extending this list requires a
 * coordinated change in the schema generator.
 */
export const VALID_FIELD_TYPES = [
  // Text types
  "text",
  "textarea",
  "richText",
  "email",
  "password",
  "code",
  // Numeric types
  "number",
  // Selection types
  "checkbox",
  "date",
  "select",
  "radio",
  // Media types
  "upload",
  // Relational types
  "relationship",
  // Structured types
  "repeater",
  "group",
  "json",
  // Selection / tag types
  "chips",
  // Component type
  "component",
] as const;

/** Set form of {@link VALID_FIELD_TYPES} for O(1) membership checks. */
export const VALID_FIELD_TYPES_SET: Set<string> = new Set(VALID_FIELD_TYPES);

/** Re-export of the shared base SQL keyword list for domain validators. */
export { RESERVED_SLUGS, SQL_RESERVED_KEYWORDS };

/** Default Set of SQL keywords (lowercased) for O(1) lookup. */
export const DEFAULT_SQL_KEYWORDS_SET: Set<string> = new Set<string>(
  SQL_RESERVED_KEYWORDS
);

// ============================================================
// Helper Functions
// ============================================================

/**
 * Checks if a string is a SQL reserved keyword.
 * Case-insensitive. Use with the pre-built {@link DEFAULT_SQL_KEYWORDS_SET}
 * or a domain-specific extension if the domain has additional reserved
 * keywords beyond the core list.
 */
export function isSQLKeyword(
  name: string,
  keywordsSet: Set<string> = DEFAULT_SQL_KEYWORDS_SET
): boolean {
  return keywordsSet.has(name.toLowerCase());
}

// ============================================================
// Slug Validation
// ============================================================

/**
 * Validate a slug against the standard Nextly rules: required, string,
 * length 1-50, pattern-conformant, not reserved, not a SQL keyword.
 *
 * Pushes errors onto `errors` using shared error codes. Domain validators
 * cast their typed error array to {@link BaseValidationError}[] at the
 * call site — every domain's error code union includes the codes pushed
 * here.
 */
export function validateSlugShared(
  slug: unknown,
  errors: BaseValidationError[],
  ctx: SlugValidationContext
): void {
  const path = "slug";

  if (!slug) {
    errors.push({
      path,
      message: `${ctx.entityLabel} slug is required`,
      code: "SLUG_REQUIRED",
    });
    return;
  }

  if (typeof slug !== "string") {
    errors.push({
      path,
      message: `${ctx.entityLabel} slug must be a string`,
      code: "SLUG_INVALID_TYPE",
    });
    return;
  }

  if (slug.length < 1) {
    errors.push({
      path,
      message: `${ctx.entityLabel} slug must be at least 1 character`,
      code: "SLUG_TOO_SHORT",
    });
  }

  if (slug.length > 50) {
    errors.push({
      path,
      message: `${ctx.entityLabel} slug must be at most 50 characters`,
      code: "SLUG_TOO_LONG",
    });
  }

  if (!SLUG_PATTERN.test(slug)) {
    errors.push({
      path,
      message: `${ctx.entityLabel} slug must start with a lowercase letter and contain only lowercase letters, numbers, hyphens, and underscores`,
      code: "SLUG_INVALID_FORMAT",
    });
  }

  if (ctx.reservedSlugsSet.has(slug.toLowerCase())) {
    errors.push({
      path,
      message: `${ctx.entityLabel} slug '${slug}' is reserved and cannot be used`,
      code: "SLUG_RESERVED",
    });
  }

  if (isSQLKeyword(slug, ctx.sqlKeywordsSet)) {
    errors.push({
      path,
      message: `${ctx.entityLabel} slug '${slug}' is a SQL reserved keyword. Use a different name or set 'dbName' to customize the table name`,
      code: "SLUG_SQL_KEYWORD",
    });
  }
}

// ============================================================
// Field Name Validation
// ============================================================

/**
 * Validate a single field name against the standard Nextly rules:
 * required, string, pattern-conformant, not a SQL keyword, unique within
 * its level (tracked via `seenNames`).
 */
export function validateFieldNameShared(
  name: unknown,
  path: string,
  errors: BaseValidationError[],
  seenNames: Set<string>,
  sqlKeywordsSet: Set<string> = DEFAULT_SQL_KEYWORDS_SET
): void {
  if (!name) {
    errors.push({
      path: `${path}.name`,
      message: "Field name is required",
      code: "FIELD_NAME_REQUIRED",
    });
    return;
  }

  if (typeof name !== "string") {
    errors.push({
      path: `${path}.name`,
      message: "Field name must be a string",
      code: "FIELD_NAME_REQUIRED",
    });
    return;
  }

  if (!FIELD_NAME_PATTERN.test(name)) {
    errors.push({
      path: `${path}.name`,
      message: `Field name '${name}' must start with a letter and contain only letters, numbers, and underscores`,
      code: "FIELD_NAME_INVALID_FORMAT",
    });
  }

  if (isSQLKeyword(name, sqlKeywordsSet)) {
    errors.push({
      path: `${path}.name`,
      message: `Field name '${name}' is a SQL reserved keyword. Consider using a different name like '${name}Field' or '${name}Value'`,
      code: "FIELD_NAME_SQL_KEYWORD",
    });
  }

  const nameLower = name.toLowerCase();
  if (seenNames.has(nameLower)) {
    errors.push({
      path: `${path}.name`,
      message: `Duplicate field name '${name}' at this level`,
      code: "FIELD_NAME_DUPLICATE",
    });
  } else {
    seenNames.add(nameLower);
  }
}

// ============================================================
// Field Type Validation
// ============================================================

/**
 * Validate that a field's `type` value is one of the Nextly-supported
 * field types. Returns `true` when the type is valid and pushes the
 * appropriate errors otherwise.
 */
export function validateFieldTypeShared(
  fieldType: unknown,
  path: string,
  errors: BaseValidationError[]
): fieldType is (typeof VALID_FIELD_TYPES)[number] {
  if (!fieldType) {
    errors.push({
      path: `${path}.type`,
      message: "Field type is required",
      code: "FIELD_TYPE_REQUIRED",
    });
    return false;
  }

  if (typeof fieldType !== "string" || !VALID_FIELD_TYPES_SET.has(fieldType)) {
    errors.push({
      path: `${path}.type`,
      message: `Invalid field type '${String(fieldType)}'. Valid types: ${VALID_FIELD_TYPES.join(", ")}`,
      code: "FIELD_TYPE_INVALID",
    });
    return false;
  }

  return true;
}

// ============================================================
// Select / Radio Options Validation
// ============================================================

/**
 * Validate the `options` array on a select or radio field: it must be
 * present, an array, and non-empty. Error codes are suffixed with
 * `SELECT_` or `RADIO_` so domain validators surface the correct tag.
 */
export function validateSelectOptionsShared(
  field: Record<string, unknown>,
  path: string,
  errors: BaseValidationError[],
  fieldType: "select" | "radio"
): void {
  const options = field.options;
  const requiredCode =
    fieldType === "select"
      ? "SELECT_OPTIONS_REQUIRED"
      : "RADIO_OPTIONS_REQUIRED";
  const emptyCode =
    fieldType === "select" ? "SELECT_OPTIONS_EMPTY" : "RADIO_OPTIONS_EMPTY";

  if (!options) {
    errors.push({
      path: `${path}.options`,
      message: `${fieldType} field must have an 'options' array`,
      code: requiredCode,
    });
    return;
  }

  if (!Array.isArray(options)) {
    errors.push({
      path: `${path}.options`,
      message: `${fieldType} field 'options' must be an array`,
      code: requiredCode,
    });
    return;
  }

  if (options.length === 0) {
    errors.push({
      path: `${path}.options`,
      message: `${fieldType} field must have at least one option`,
      code: emptyCode,
    });
  }
}

// ============================================================
// Relationship Target Validation
// ============================================================

/**
 * Validate a relationship field's `relationTo` property.
 *
 * Accepts either a single slug string or an array of slug strings. When
 * `validCollectionSlugs` is provided (collections pass it, singles and
 * components leave it undefined), each target is also checked for
 * existence against that whitelist and an additional
 * `RELATIONSHIP_TARGET_UNKNOWN` error is pushed for unknown targets.
 */
export function validateRelationshipTargetShared(
  field: Record<string, unknown>,
  path: string,
  errors: BaseValidationError[],
  validCollectionSlugs?: string[]
): void {
  const relationTo = field.relationTo;

  if (!relationTo) {
    errors.push({
      path: `${path}.relationTo`,
      message: "Relationship field must specify 'relationTo'",
      code: "RELATIONSHIP_TARGET_REQUIRED",
    });
    return;
  }

  const knownSet = validCollectionSlugs
    ? new Set(validCollectionSlugs)
    : undefined;
  const knownList = validCollectionSlugs?.join(", ") ?? "";

  if (typeof relationTo === "string") {
    if (!SLUG_PATTERN.test(relationTo)) {
      errors.push({
        path: `${path}.relationTo`,
        message: `Invalid relationTo value '${relationTo}'. Must be a valid collection slug`,
        code: "RELATIONSHIP_TARGET_INVALID",
      });
    } else if (knownSet && !knownSet.has(relationTo)) {
      errors.push({
        path: `${path}.relationTo`,
        message: `Unknown collection '${relationTo}' in relationTo. Available collections: ${knownList}`,
        code: "RELATIONSHIP_TARGET_UNKNOWN",
      });
    }
    return;
  }

  if (Array.isArray(relationTo)) {
    if (relationTo.length === 0) {
      errors.push({
        path: `${path}.relationTo`,
        message: "Relationship field 'relationTo' array cannot be empty",
        code: "RELATIONSHIP_TARGET_REQUIRED",
      });
      return;
    }

    relationTo.forEach((target, index) => {
      if (typeof target !== "string") {
        errors.push({
          path: `${path}.relationTo[${index}]`,
          message: "Each relationTo value must be a string",
          code: "RELATIONSHIP_TARGET_INVALID",
        });
      } else if (!SLUG_PATTERN.test(target)) {
        errors.push({
          path: `${path}.relationTo[${index}]`,
          message: `Invalid relationTo value '${target}'. Must be a valid collection slug`,
          code: "RELATIONSHIP_TARGET_INVALID",
        });
      } else if (knownSet && !knownSet.has(target)) {
        errors.push({
          path: `${path}.relationTo[${index}]`,
          message: `Unknown collection '${target}' in relationTo. Available collections: ${knownList}`,
          code: "RELATIONSHIP_TARGET_UNKNOWN",
        });
      }
    });
    return;
  }

  errors.push({
    path: `${path}.relationTo`,
    message: "'relationTo' must be a string or array of strings",
    code: "RELATIONSHIP_TARGET_INVALID",
  });
}

// ============================================================
// Component Field Reference Validation
// ============================================================

/**
 * Validate a component-typed field's reference shape.
 *
 * A component field must specify exactly one of:
 * - `component: string` — single component slug
 * - `components: string[]` — dynamic-zone list of component slugs
 *
 * Pushes errors for missing, conflicting, invalid-type, or empty refs.
 */
export function validateComponentFieldRefShared(
  field: Record<string, unknown>,
  path: string,
  errors: BaseValidationError[]
): void {
  const singleComp = field.component;
  const multiComp = field.components;

  if (!singleComp && !multiComp) {
    errors.push({
      path,
      message:
        "Component field must specify either 'component' (single) or 'components' (multi/dynamic zone)",
      code: "COMPONENT_REF_REQUIRED",
    });
    return;
  }

  if (singleComp && multiComp) {
    errors.push({
      path,
      message:
        "Component field cannot specify both 'component' and 'components'. Use 'component' for single component or 'components' for dynamic zone",
      code: "COMPONENT_REF_CONFLICT",
    });
    return;
  }

  if (singleComp !== undefined && singleComp !== null) {
    if (typeof singleComp !== "string") {
      errors.push({
        path: `${path}.component`,
        message: "'component' must be a string (component slug)",
        code: "COMPONENT_REF_INVALID",
      });
    }
    return;
  }

  // multiComp branch
  if (!Array.isArray(multiComp)) {
    errors.push({
      path: `${path}.components`,
      message: "'components' must be an array of component slugs",
      code: "COMPONENT_REF_INVALID",
    });
    return;
  }

  if (multiComp.length === 0) {
    errors.push({
      path: `${path}.components`,
      message: "'components' array must have at least one component slug",
      code: "COMPONENT_REF_EMPTY",
    });
    return;
  }

  multiComp.forEach((slug: unknown, index: number) => {
    if (typeof slug !== "string") {
      errors.push({
        path: `${path}.components[${index}]`,
        message: "Each component slug must be a string",
        code: "COMPONENT_REF_INVALID",
      });
    }
  });
}
