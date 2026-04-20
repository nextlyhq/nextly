import { z } from "zod";

import type { FieldDefinition } from "@nextly/schemas/dynamic-collections";

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

export const fieldsArraySchema = z
  .array(z.any())
  .min(1, "Collection must have at least one field")
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

      if (field.type === "relation") {
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
   * @throws Error if the regex is invalid or contains unsafe constructs
   */
  validateRegexPattern(fieldName: string, pattern: string): void {
    try {
      new RegExp(pattern);
      if (pattern.includes("(?{") || pattern.includes("(?>")) {
        throw new Error(
          `Regex pattern for field "${fieldName}" contains unsafe constructs`
        );
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(
        `Invalid regex pattern for field "${fieldName}": ${message}`
      );
    }
  }
}
