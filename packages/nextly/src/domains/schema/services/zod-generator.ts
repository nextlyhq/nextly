/**
 * Zod Schema Generator Service
 *
 * Generates Zod validation schemas from collection definitions.
 * Creates type-safe validation schemas for runtime data validation.
 *
 * Generates three schema variants for each collection:
 * - Base schema: All fields including id and timestamps
 * - Create input schema: Omits id and timestamps
 * - Update input schema: All fields optional except id
 *
 * @module services/schema/zod-generator
 * @since 1.0.0
 */

import type { FieldConfig, DataFieldConfig } from "@nextly/collections";

import {
  isTextField,
  isTextareaField,
  isRichTextField,
  isEmailField,
  isPasswordField,
  isCodeField,
  isNumberField,
  isCheckboxField,
  isDateField,
  isSelectField,
  isRadioField,
  isUploadField,
  isRelationshipField,
  isRepeaterField,
  isGroupField,
  isJSONField,
  isChipsField,
  isDataField,
} from "../../../collections/fields/guards";
import type { DynamicCollectionRecord } from "../../../schemas/dynamic-collections/types";

// ============================================================
// Types
// ============================================================

/**
 * Result of generating a Zod schema for a single collection.
 */
export interface GeneratedZodSchema {
  /** Collection slug */
  collectionSlug: string;

  /** Generated TypeScript code for the Zod schemas */
  code: string;

  /** Suggested filename (e.g., "posts.zod.ts") */
  filename: string;
}

/**
 * Result of generating an index file that exports all Zod schemas.
 */
export interface GeneratedZodIndexFile {
  /** Generated TypeScript code for the index file */
  code: string;

  /** Suggested filename (always "index.ts") */
  filename: string;
}

/**
 * Options for Zod schema generation.
 */
export interface ZodGeneratorOptions {
  /**
   * Whether to generate TypeScript type exports using z.infer<>.
   * @default true
   */
  generateTypes?: boolean;

  /**
   * Whether to include JSDoc comments in generated code.
   * @default true
   */
  includeComments?: boolean;

  /**
   * Custom prefix for schema names.
   * @default "" (uses collection slug)
   */
  schemaPrefix?: string;
}

// ============================================================
// ZodGenerator Class
// ============================================================

/**
 * Generates Zod validation schemas from collection definitions.
 *
 * The generator creates TypeScript code with Zod schemas that can be
 * written to files and used for runtime validation.
 *
 * @example
 * ```typescript
 * const generator = new ZodGenerator();
 *
 * // Generate schema for a single collection
 * const schema = generator.generateSchema(postsCollection);
 * console.log(schema.code);
 *
 * // Generate schemas for all collections
 * const schemas = generator.generateAllSchemas(collections);
 *
 * // Generate index file
 * const indexFile = generator.generateIndexFile(collections);
 * ```
 */
export class ZodGenerator {
  private readonly generateTypes: boolean;
  private readonly includeComments: boolean;
  private readonly schemaPrefix: string;

  constructor(options: ZodGeneratorOptions = {}) {
    this.generateTypes = options.generateTypes ?? true;
    this.includeComments = options.includeComments ?? true;
    this.schemaPrefix = options.schemaPrefix ?? "";
  }

  // ============================================================
  // Public API
  // ============================================================

  /**
   * Generates Zod schemas for a single collection.
   *
   * Creates three schema variants:
   * - {Name}Schema: Base schema with all fields
   * - {Name}CreateInputSchema: Omits id and timestamps
   * - {Name}UpdateInputSchema: All fields partial except id
   *
   * @param collection - The collection record to generate schemas for
   * @returns Generated schema with code, filename, and metadata
   */
  generateSchema(collection: DynamicCollectionRecord): GeneratedZodSchema {
    const imports = this.generateImports();
    const schemas = this.generateSchemaDefinitions(collection);
    const types = this.generateTypes
      ? this.generateTypeExports(collection)
      : "";

    const code = [imports, "", schemas, types].filter(Boolean).join("\n");

    return {
      collectionSlug: collection.slug,
      code,
      filename: `${collection.slug}.zod.ts`,
    };
  }

  /**
   * Generates Zod schemas for multiple collections.
   *
   * @param collections - Array of collection records
   * @returns Array of generated schemas
   */
  generateAllSchemas(
    collections: DynamicCollectionRecord[]
  ): GeneratedZodSchema[] {
    return collections.map(collection => this.generateSchema(collection));
  }

  /**
   * Generates an index file that exports all collection Zod schemas.
   *
   * @param collections - Array of collection records
   * @returns Generated index file with exports
   */
  generateIndexFile(
    collections: DynamicCollectionRecord[]
  ): GeneratedZodIndexFile {
    const exports = collections
      .map(c => `export * from "./${c.slug}.zod";`)
      .sort()
      .join("\n");

    const code = [
      "/**",
      " * Generated Zod Schema Index",
      " *",
      " * Auto-generated by Nextly ZodGenerator.",
      " * Do not edit this file manually.",
      " *",
      " * @generated",
      " */",
      "",
      exports,
      "",
    ].join("\n");

    return {
      code,
      filename: "index.ts",
    };
  }

  // ============================================================
  // Import Generation
  // ============================================================

  /**
   * Generates import statements for the schema file.
   */
  private generateImports(): string {
    return `import { z } from "zod";`;
  }

  // ============================================================
  // Schema Generation
  // ============================================================

  /**
   * Generates all schema definitions for a collection.
   */
  private generateSchemaDefinitions(
    collection: DynamicCollectionRecord
  ): string {
    const schemaName = this.getSchemaName(collection.slug);
    const lines: string[] = [];

    // Base schema comment
    if (this.includeComments) {
      lines.push(`/**`);
      lines.push(` * ${collection.labels.singular} base schema.`);
      if (collection.description) {
        lines.push(` *`);
        lines.push(` * ${collection.description}`);
      }
      lines.push(` *`);
      lines.push(` * @generated by Nextly ZodGenerator`);
      lines.push(` */`);
    }

    // Base schema with all fields
    lines.push(`export const ${schemaName}Schema = z.object({`);
    lines.push(`  id: z.string(),`);

    // Add field schemas
    for (const field of collection.fields) {
      if (!isDataField(field)) continue;

      const fieldSchema = this.generateFieldSchema(field);
      if (fieldSchema) {
        lines.push(fieldSchema);
      }
    }

    // Add timestamp fields if collection has timestamps
    if (collection.timestamps) {
      lines.push(`  createdAt: z.string().datetime(),`);
      lines.push(`  updatedAt: z.string().datetime(),`);
    }

    lines.push(`});`);
    lines.push("");

    // Create input schema (omit id and timestamps)
    if (this.includeComments) {
      lines.push(`/**`);
      lines.push(
        ` * ${collection.labels.singular} create input schema (omits id and timestamps).`
      );
      lines.push(` *`);
      lines.push(` * @generated by Nextly ZodGenerator`);
      lines.push(` */`);
    }

    const omitFields = ["id"];
    if (collection.timestamps) {
      omitFields.push("createdAt", "updatedAt");
    }

    lines.push(
      `export const ${schemaName}CreateInputSchema = ${schemaName}Schema.omit({`
    );
    for (const field of omitFields) {
      lines.push(`  ${field}: true,`);
    }
    lines.push(`});`);
    lines.push("");

    // Update input schema (all optional except id)
    if (this.includeComments) {
      lines.push(`/**`);
      lines.push(
        ` * ${collection.labels.singular} update input schema (all fields optional except id).`
      );
      lines.push(` *`);
      lines.push(` * @generated by Nextly ZodGenerator`);
      lines.push(` */`);
    }

    lines.push(
      `export const ${schemaName}UpdateInputSchema = ${schemaName}Schema.partial().required({`
    );
    lines.push(`  id: true,`);
    lines.push(`});`);

    return lines.join("\n");
  }

  /**
   * Generates a Zod schema string for a single field.
   */
  private generateFieldSchema(field: DataFieldConfig): string | null {
    // Skip fields without names
    if (!("name" in field) || !field.name) {
      return null;
    }

    const fieldName = field.name;
    let zodSchema: string;
    const modifiers: string[] = [];

    // Handle required/optional
    const isRequired = "required" in field && field.required;

    // Text fields
    if (isTextField(field)) {
      zodSchema = this.buildTextSchema(field);
    }
    // Textarea fields
    else if (isTextareaField(field)) {
      zodSchema = "z.string()";
      if ("minLength" in field && field.minLength !== undefined) {
        modifiers.push(`.min(${field.minLength})`);
      }
      if ("maxLength" in field && field.maxLength !== undefined) {
        modifiers.push(`.max(${field.maxLength})`);
      }
    }
    // RichText fields
    else if (isRichTextField(field)) {
      zodSchema = "z.string()";
    }
    // Email fields
    else if (isEmailField(field)) {
      zodSchema = "z.string().email()";
    }
    // Password fields
    else if (isPasswordField(field)) {
      zodSchema = "z.string()";
      if ("minLength" in field && field.minLength !== undefined) {
        modifiers.push(`.min(${field.minLength})`);
      }
      if ("maxLength" in field && field.maxLength !== undefined) {
        modifiers.push(`.max(${field.maxLength})`);
      }
    }
    // Code fields
    else if (isCodeField(field)) {
      zodSchema = "z.string()";
    }
    // Number fields
    else if (isNumberField(field)) {
      zodSchema = this.buildNumberSchema(field);
    }
    // Checkbox fields
    else if (isCheckboxField(field)) {
      zodSchema = "z.boolean()";
    }
    // Date fields
    else if (isDateField(field)) {
      // Store as ISO string (datetime)
      zodSchema = "z.string().datetime()";
    }
    // Select fields
    else if (isSelectField(field)) {
      zodSchema = this.buildSelectSchema(field);
    }
    // Radio fields
    else if (isRadioField(field)) {
      zodSchema = this.buildRadioSchema(field);
    }
    // Upload fields
    else if (isUploadField(field)) {
      zodSchema = this.buildUploadSchema(field);
    }
    // Relationship fields
    else if (isRelationshipField(field)) {
      zodSchema = this.buildRelationshipSchema(field);
    }
    // Repeater fields
    else if (isRepeaterField(field)) {
      zodSchema = this.buildArraySchema(field);
    }
    // Group fields
    else if (isGroupField(field)) {
      zodSchema = this.buildGroupSchema(field);
    }
    // JSON fields
    else if (isJSONField(field)) {
      zodSchema = "z.any()";
    }
    // Chips fields
    else if (isChipsField(field)) {
      zodSchema = this.buildChipsSchema(field);
    }
    // Unknown field type
    else {
      return null;
    }

    // Apply modifiers
    const schemaWithModifiers = zodSchema + modifiers.join("");

    // Apply optional if not required
    const finalSchema = isRequired
      ? schemaWithModifiers
      : `${schemaWithModifiers}.optional()`;

    return `  ${fieldName}: ${finalSchema},`;
  }

  // ============================================================
  // Field-Specific Schema Builders
  // ============================================================

  /**
   * Builds Zod schema for text fields.
   */
  private buildTextSchema(field: DataFieldConfig): string {
    const modifiers: string[] = [];

    if ("minLength" in field && field.minLength !== undefined) {
      modifiers.push(`.min(${field.minLength})`);
    }
    if ("maxLength" in field && field.maxLength !== undefined) {
      modifiers.push(`.max(${field.maxLength})`);
    }

    const baseSchema = `z.string()${modifiers.join("")}`;

    // Handle hasMany
    if ("hasMany" in field && field.hasMany) {
      let arraySchema = `z.array(${baseSchema})`;

      if ("minRows" in field && field.minRows !== undefined) {
        arraySchema += `.min(${field.minRows})`;
      }
      if ("maxRows" in field && field.maxRows !== undefined) {
        arraySchema += `.max(${field.maxRows})`;
      }

      return arraySchema;
    }

    return baseSchema;
  }

  /**
   * Builds Zod schema for number fields.
   */
  private buildNumberSchema(field: DataFieldConfig): string {
    const modifiers: string[] = [];

    if ("min" in field && field.min !== undefined) {
      modifiers.push(`.min(${field.min})`);
    }
    if ("max" in field && field.max !== undefined) {
      modifiers.push(`.max(${field.max})`);
    }

    const baseSchema = `z.number()${modifiers.join("")}`;

    // Handle hasMany
    if ("hasMany" in field && field.hasMany) {
      let arraySchema = `z.array(${baseSchema})`;

      if ("minRows" in field && field.minRows !== undefined) {
        arraySchema += `.min(${field.minRows})`;
      }
      if ("maxRows" in field && field.maxRows !== undefined) {
        arraySchema += `.max(${field.maxRows})`;
      }

      return arraySchema;
    }

    return baseSchema;
  }

  /**
   * Builds Zod schema for select fields.
   */
  private buildSelectSchema(field: DataFieldConfig): string {
    // Extract option values
    const options =
      "options" in field && Array.isArray(field.options)
        ? (field.options as Array<{ value: string } | string>)
        : [];

    const values = options.map(opt =>
      typeof opt === "string" ? opt : opt.value
    );

    if (values.length === 0) {
      // Fallback to string if no options defined
      return "hasMany" in field && field.hasMany
        ? "z.array(z.string())"
        : "z.string()";
    }

    const enumValues = values.map(v => `"${this.escapeString(v)}"`).join(", ");
    const enumSchema = `z.enum([${enumValues}])`;

    // Handle hasMany
    if ("hasMany" in field && field.hasMany) {
      return `z.array(${enumSchema})`;
    }

    return enumSchema;
  }

  /**
   * Builds Zod schema for radio fields.
   */
  private buildRadioSchema(field: DataFieldConfig): string {
    // Extract option values
    const options =
      "options" in field && Array.isArray(field.options)
        ? (field.options as Array<{ value: string } | string>)
        : [];

    const values = options.map(opt =>
      typeof opt === "string" ? opt : opt.value
    );

    if (values.length === 0) {
      return "z.string()";
    }

    const enumValues = values.map(v => `"${this.escapeString(v)}"`).join(", ");
    return `z.enum([${enumValues}])`;
  }

  /**
   * Builds Zod schema for upload fields.
   */
  private buildUploadSchema(field: DataFieldConfig): string {
    // Uploads store file IDs as strings
    if ("hasMany" in field && field.hasMany) {
      return "z.array(z.string())";
    }

    // Check for polymorphic relation
    if (
      "relationTo" in field &&
      Array.isArray((field as { relationTo?: unknown }).relationTo)
    ) {
      // Polymorphic: store as object with relationTo and value
      return "z.object({ relationTo: z.string(), value: z.string() })";
    }

    return "z.string()";
  }

  /**
   * Builds Zod schema for relationship fields.
   */
  private buildRelationshipSchema(field: DataFieldConfig): string {
    // Check for polymorphic relation
    const isPolymorphic =
      "relationTo" in field &&
      Array.isArray((field as { relationTo?: unknown }).relationTo);

    if (isPolymorphic) {
      // Polymorphic: store as object with relationTo and value
      const itemSchema =
        "z.object({ relationTo: z.string(), value: z.string() })";

      if ("hasMany" in field && field.hasMany) {
        return `z.array(${itemSchema})`;
      }

      return itemSchema;
    }

    // Simple relationship - store as ID string
    if ("hasMany" in field && field.hasMany) {
      return "z.array(z.string())";
    }

    return "z.string()";
  }

  /**
   * Builds Zod schema for repeater fields (nested fields).
   */
  private buildArraySchema(field: DataFieldConfig): string {
    // Get nested fields
    const nestedFields =
      "fields" in field && Array.isArray(field.fields)
        ? (field.fields as FieldConfig[])
        : [];

    // Build object schema for array items
    const itemSchema = this.buildNestedObjectSchema(nestedFields);
    let arraySchema = `z.array(${itemSchema})`;

    // Apply min/max rows
    if ("minRows" in field && field.minRows !== undefined) {
      arraySchema += `.min(${field.minRows})`;
    }
    if ("maxRows" in field && field.maxRows !== undefined) {
      arraySchema += `.max(${field.maxRows})`;
    }

    return arraySchema;
  }

  /**
   * Builds Zod schema for group fields (nested object).
   */
  private buildGroupSchema(field: DataFieldConfig): string {
    // Get nested fields
    const nestedFields =
      "fields" in field && Array.isArray(field.fields)
        ? (field.fields as FieldConfig[])
        : [];

    return this.buildNestedObjectSchema(nestedFields);
  }

  /**
   * Builds Zod schema for chips fields.
   */
  private buildChipsSchema(field: DataFieldConfig): string {
    let arraySchema = "z.array(z.string())";

    if ("minChips" in field && field.minChips !== undefined) {
      arraySchema += `.min(${field.minChips})`;
    }
    if ("maxChips" in field && field.maxChips !== undefined) {
      arraySchema += `.max(${field.maxChips})`;
    }

    return arraySchema;
  }

  /**
   * Builds a Zod object schema from nested fields.
   */
  private buildNestedObjectSchema(fields: FieldConfig[]): string {
    const fieldSchemas: string[] = [];

    for (const field of fields) {
      if (!isDataField(field)) continue;

      // Skip fields without names
      if (!("name" in field) || !field.name) continue;

      const fieldName = field.name;
      const isRequired = "required" in field && field.required;

      // Recursively build field schema (simplified - reuse main logic)
      let zodSchema: string;

      if (isTextField(field)) {
        zodSchema = this.buildTextSchema(field);
      } else if (isTextareaField(field)) {
        zodSchema = "z.string()";
      } else if (isRichTextField(field)) {
        zodSchema = "z.string()";
      } else if (isEmailField(field)) {
        zodSchema = "z.string().email()";
      } else if (isPasswordField(field)) {
        zodSchema = "z.string()";
      } else if (isCodeField(field)) {
        zodSchema = "z.string()";
      } else if (isNumberField(field)) {
        zodSchema = this.buildNumberSchema(field);
      } else if (isCheckboxField(field)) {
        zodSchema = "z.boolean()";
      } else if (isDateField(field)) {
        zodSchema = "z.string().datetime()";
      } else if (isSelectField(field)) {
        zodSchema = this.buildSelectSchema(field);
      } else if (isRadioField(field)) {
        zodSchema = this.buildRadioSchema(field);
      } else if (isUploadField(field)) {
        zodSchema = this.buildUploadSchema(field);
      } else if (isRelationshipField(field)) {
        zodSchema = this.buildRelationshipSchema(field);
      } else if (isRepeaterField(field)) {
        zodSchema = this.buildArraySchema(field);
      } else if (isGroupField(field)) {
        zodSchema = this.buildGroupSchema(field);
      } else if (isJSONField(field)) {
        zodSchema = "z.any()";
      } else if (isChipsField(field)) {
        zodSchema = this.buildChipsSchema(field);
      } else {
        continue;
      }

      // Apply optional if not required
      const finalSchema = isRequired ? zodSchema : `${zodSchema}.optional()`;

      fieldSchemas.push(`${fieldName}: ${finalSchema}`);
    }

    if (fieldSchemas.length === 0) {
      return "z.object({})";
    }

    return `z.object({ ${fieldSchemas.join(", ")} })`;
  }

  // ============================================================
  // Type Exports Generation
  // ============================================================

  /**
   * Generates TypeScript type exports using z.infer<>.
   */
  private generateTypeExports(collection: DynamicCollectionRecord): string {
    const schemaName = this.getSchemaName(collection.slug);
    const lines: string[] = [];

    lines.push("");

    // Base type
    if (this.includeComments) {
      lines.push(`/**`);
      lines.push(` * ${collection.labels.singular} type.`);
      lines.push(` *`);
      lines.push(` * @generated by Nextly ZodGenerator`);
      lines.push(` */`);
    }
    lines.push(
      `export type ${schemaName} = z.infer<typeof ${schemaName}Schema>;`
    );
    lines.push("");

    // Create input type
    if (this.includeComments) {
      lines.push(`/**`);
      lines.push(` * ${collection.labels.singular} create input type.`);
      lines.push(` *`);
      lines.push(` * @generated by Nextly ZodGenerator`);
      lines.push(` */`);
    }
    lines.push(
      `export type ${schemaName}CreateInput = z.infer<typeof ${schemaName}CreateInputSchema>;`
    );
    lines.push("");

    // Update input type
    if (this.includeComments) {
      lines.push(`/**`);
      lines.push(` * ${collection.labels.singular} update input type.`);
      lines.push(` *`);
      lines.push(` * @generated by Nextly ZodGenerator`);
      lines.push(` */`);
    }
    lines.push(
      `export type ${schemaName}UpdateInput = z.infer<typeof ${schemaName}UpdateInputSchema>;`
    );

    return lines.join("\n");
  }

  // ============================================================
  // Utility Methods
  // ============================================================

  /**
   * Gets the schema name from a collection slug.
   * e.g., "blog-posts" -> "BlogPost"
   */
  private getSchemaName(slug: string): string {
    const baseName = slug
      .split(/[-_]/)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join("");

    return this.schemaPrefix + baseName;
  }

  /**
   * Escapes special characters in a string for use in generated code.
   */
  private escapeString(str: string): string {
    return str
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t");
  }
}
