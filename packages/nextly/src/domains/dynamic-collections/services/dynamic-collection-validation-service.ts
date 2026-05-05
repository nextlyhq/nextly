import safeRegex from "safe-regex2";
import { z } from "zod";

import type { FieldDefinition } from "@nextly/schemas/dynamic-collections";

/**
 * Cap admin-supplied regex pattern length. Long patterns are both
 * useless (almost no real-world validation needs 200+ chars) and a
 * vector for hiding catastrophic-backtracking constructs that defeat
 * static analyzers.
 */
const MAX_REGEX_PATTERN_LENGTH = 200;

/**
 * Characters that would break the surrounding
 * `CHECK (col ~ '…')` constraint expression when embedded as raw text
 * after the existing single-quote escaping. The R3 update notes that
 * `replace(/'/g, "''")` alone is not sufficient — a regex containing
 * a stray `;`, backslash, or newline can corrupt the DDL even without
 * SQL injection. We allowlist by reject-listing the smallest set that
 * shouldn't appear in any reasonable validation pattern.
 */
const REGEX_DDL_FORBIDDEN_CHARS = /[;\\\n\r\0]/;

/** SQL keywords that should be blocked as field/collection names. */
export const SQL_KEYWORDS = [
  "select",
  "insert",
  "update",
  "delete",
  "drop",
  "create",
  "alter",
  "table",
  "from",
  "where",
  "join",
  "union",
  "order",
  "group",
  "having",
  "limit",
  "offset",
  "index",
  "constraint",
  "primary",
  "foreign",
  "key",
  "references",
  "on",
  "null",
  "not",
  "and",
  "or",
  "in",
  "like",
  "between",
  "exists",
  "case",
  "when",
  "then",
  "else",
  "end",
  "as",
  "distinct",
  "all",
  "any",
  "some",
  "into",
  "values",
  "set",
  "cascade",
] as const;

/** Reserved names for collections. */
export const RESERVED_COLLECTION_NAMES = [
  "users",
  "roles",
  "permissions",
  "sessions",
  "accounts",
  "dynamic_collections",
] as const;

/** Reserved field names (added automatically). */
export const RESERVED_FIELD_NAMES = [
  "id",
  "title",
  "slug",
  "created_at",
  "updated_at",
] as const;

export const collectionNameSchema = z
  .string()
  .min(1, "Collection name cannot be empty")
  .max(50, "Collection name must be 50 characters or less")
  .regex(
    /^[a-z][a-z0-9_]*$/,
    "Collection name must start with lowercase letter and contain only lowercase letters, numbers, and underscores"
  )
  .refine(
    (name: string) => !RESERVED_COLLECTION_NAMES.includes(name as never),
    {
      message: "Collection name is reserved",
    }
  )
  .refine(
    (name: string) => !SQL_KEYWORDS.includes(name.toLowerCase() as never),
    {
      message: "Collection name is a reserved SQL keyword",
    }
  );

export const fieldNameSchema = z
  .string()
  .min(1, "Field name cannot be empty")
  .max(50, "Field name must be 50 characters or less")
  .regex(
    /^[a-z][a-z0-9_]*$/,
    "Field name must start with lowercase letter and contain only lowercase letters, numbers, and underscores"
  )
  .refine((name: string) => !RESERVED_FIELD_NAMES.includes(name as never), {
    message: "Field name is reserved",
  })
  .refine(
    (name: string) => !SQL_KEYWORDS.includes(name.toLowerCase() as never),
    {
      message: "Field name is a reserved SQL keyword",
    }
  );

// Why: the new modal-driven create flow (Builder redesign PR 2) creates a
// collection with empty user fields and lets the user add fields on the
// next page. The server already auto-injects system columns (id, title,
// slug, plus createdAt/updatedAt/status when those toggles are on), so a
// "fieldless" collection has 4-7 real DB columns. The legacy "at least
// one user field" rule was a UI assumption baked into the API; relaxing
// to min(0) lets create-then-add-fields work without breaking
// update flows (removing all user fields is also valid — the system
// columns remain).
export const fieldsArraySchema = z
  .array(z.any())
  .min(0)
  .max(100, "Collection cannot have more than 100 fields");

export class DynamicCollectionValidationService {
  /**
   * @throws Error if the name is invalid
   */
  validateCollectionName(name: string): void {
    const result = collectionNameSchema.safeParse(name);
    if (!result.success) {
      const errorMessage =
        result.error.issues[0]?.message || "Invalid collection name";
      throw new Error(errorMessage);
    }
  }

  /**
   * @throws Error if any field name is invalid or duplicated
   */
  validateFieldNames(fields: FieldDefinition[]): void {
    const countResult = fieldsArraySchema.safeParse(fields);
    if (!countResult.success) {
      const errorMessage =
        countResult.error.issues[0]?.message || "Invalid fields array";
      throw new Error(errorMessage);
    }

    const fieldNames = new Set<string>();
    const duplicates: string[] = [];

    for (const field of fields) {
      if (fieldNames.has(field.name)) {
        duplicates.push(field.name);
      }
      fieldNames.add(field.name);
    }

    if (duplicates.length > 0) {
      throw new Error(
        `Duplicate field names found: ${duplicates.join(", ")}. Each field must have a unique name.`
      );
    }

    for (const field of fields) {
      const result = fieldNameSchema.safeParse(field.name);
      if (!result.success) {
        const errorMessage =
          result.error.issues[0]?.message ||
          `Invalid field name "${field.name}"`;
        throw new Error(errorMessage);
      }

      if (field.type === "relationship") {
        this.validateRelationshipField(field);
      }
    }
  }

  /**
   * @throws Error if the relationship configuration is invalid
   */
  validateRelationshipField(field: FieldDefinition): void {
    if (!field.options?.target) {
      throw new Error(
        `Relationship field "${field.name}" must specify a target collection`
      );
    }

    if (!field.options?.relationType) {
      throw new Error(
        `Relationship field "${field.name}" must specify a relationType (oneToOne, oneToMany, manyToOne, or manyToMany)`
      );
    }

    const validTypes = ["oneToOne", "oneToMany", "manyToOne", "manyToMany"];
    if (!validTypes.includes(field.options.relationType)) {
      throw new Error(
        `Invalid relationType "${field.options.relationType}" for field "${field.name}". Must be one of: ${validTypes.join(", ")}`
      );
    }

    if (field.options.onDelete) {
      const validActions = ["cascade", "set null", "restrict", "no action"];
      if (!validActions.includes(field.options.onDelete.toLowerCase())) {
        throw new Error(
          `Invalid onDelete action "${field.options.onDelete}" for field "${field.name}". Must be one of: ${validActions.join(", ")}`
        );
      }
    }

    if (field.options.onUpdate) {
      const validActions = ["cascade", "set null", "restrict", "no action"];
      if (!validActions.includes(field.options.onUpdate.toLowerCase())) {
        throw new Error(
          `Invalid onUpdate action "${field.options.onUpdate}" for field "${field.name}". Must be one of: ${validActions.join(", ")}`
        );
      }
    }

    if (
      field.options.relationType === "oneToOne" &&
      !field.unique &&
      !field.required
    ) {
      console.warn(
        `One-to-one relationship "${field.name}" should typically be unique. Consider setting unique: true.`
      );
    }

    // manyToMany relationships use a junction table and cannot be required.
    if (field.options.relationType === "manyToMany" && field.required) {
      throw new Error(
        `Many-to-many relationship "${field.name}" cannot be marked as required. Use validation in your application logic instead.`
      );
    }
  }

  /**
   * The previous check only blocked `(?{` and `(?>` —
   * neither of which is even valid JS regex syntax, so the function
   * accepted catastrophic patterns like `(a+)+b` that DoS the database
   * regex engine on subsequent writes.
   *
   * The new gate has three layers:
   *
   *   1. **Length cap** (≤200 chars). Real validation patterns are
   *      short; long patterns are usually obfuscated.
   *   2. **JS parse**. If `new RegExp(pattern)` throws, it's malformed
   *      regardless of the runtime that will execute it.
   *   3. **`safe-regex2`** static analysis. Detects nested-quantifier
   *      and alternation explosion patterns (the standard ReDoS shapes).
   *
   * In this codebase the runtime engine is the database (Postgres `~`
   * or MySQL `REGEXP`), not Node — JS-side runtime matching of admin-
   * supplied patterns does not exist here. So we don't pull in the
   * native re2 binding; the static `safe-regex2` check + length cap is
   * the load-bearing defense for what actually ships to the DB.
   *
   * @throws Error if the regex is invalid, too long, or unsafe
   */
  validateRegexPattern(fieldName: string, pattern: string): void {
    if (pattern.length > MAX_REGEX_PATTERN_LENGTH) {
      throw new Error(
        `Regex pattern for field "${fieldName}" exceeds the ${MAX_REGEX_PATTERN_LENGTH}-character cap (got ${pattern.length}).`
      );
    }

    try {
      new RegExp(pattern);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(
        `Invalid regex pattern for field "${fieldName}": ${message}`
      );
    }

    if (!safeRegex(pattern)) {
      throw new Error(
        `Regex pattern for field "${fieldName}" is unsafe (catastrophic backtracking detected).`
      );
    }

    if (REGEX_DDL_FORBIDDEN_CHARS.test(pattern)) {
      throw new Error(
        `Regex pattern for field "${fieldName}" contains characters that are not allowed in CHECK constraint expressions (no semicolons, backslashes, newlines, or null bytes).`
      );
    }
  }
}
