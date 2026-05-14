/**
 * Per-collection schema derivation — the bridge between field mappers and
 * the generator pipeline.
 *
 * Two public functions:
 *
 *   deriveCollectionSchemas(collection)
 *     Returns { schemas, baseName }. schemas always contains exactly three
 *     entries: <BaseName> (Read), Create<BaseName>, Update<BaseName>.
 *     Read carries system fields (id, createdAt/updatedAt when timestamps,
 *     _status when status: true); Create omits all of them but keeps
 *     password fields; Update has the same properties as Create but no
 *     `required` array (all fields optional for partial update).
 *
 *   deriveNestedItemSchemas(collection, baseName)
 *     Walks the field tree and registers one schema per repeater under the
 *     name `<BaseName>__<FieldName>Item`. Recurses into groups, components
 *     (named slot variants), and nested repeaters.
 *
 * @module nextly/openapi/mapping/derive-schemas
 */

import type { CollectionConfig } from "../../collections/config/define-collection";
import type { FieldConfig } from "../../collections/fields/types";
import type { SingleConfig } from "../../singles/config/types";
import type { OpenAPISchema } from "../types";

import { collectionSchemaName, pascalize } from "./_inflect";
import { composeFieldsToObjectSchema } from "./fields/_compose";
import type { MappingContext } from "./fields/types";

export interface DerivedSchemas {
  schemas: Record<string, OpenAPISchema>;
  baseName: string;
}

export function deriveCollectionSchemas(
  collection: CollectionConfig
): DerivedSchemas {
  const baseName = collectionSchemaName(
    collection.slug,
    collection.labels?.singular
  );
  const ctx: MappingContext = {
    schemaRef: n => ({ $ref: `#/components/schemas/${n}` }),
    ownerSlug: baseName,
    fieldPath: `collections.${collection.slug}`,
  };

  const composed = composeFieldsToObjectSchema(collection.fields, ctx);

  // Read schema (output) — user fields + system fields.
  const readProperties: Record<string, OpenAPISchema> = {
    ...((composed.output as { properties?: Record<string, OpenAPISchema> })
      .properties ?? {}),
  };
  readProperties.id = { type: "string", readOnly: true };
  if (collection.timestamps !== false) {
    readProperties.createdAt = {
      type: "string",
      format: "date-time",
      readOnly: true,
    };
    readProperties.updatedAt = {
      type: "string",
      format: "date-time",
      readOnly: true,
    };
  }
  if (collection.status === true) {
    readProperties._status = {
      type: "string",
      enum: ["draft", "published"],
      readOnly: true,
    };
  }

  const ReadSchema: OpenAPISchema = {
    type: "object",
    properties: readProperties,
  };
  const readRequired = (composed.output as { required?: string[] }).required;
  if (readRequired && readRequired.length > 0) {
    ReadSchema.required = readRequired;
  }

  // Create schema (input shape) — user fields only, no system fields.
  const inputProperties =
    (
      composed.input as {
        properties?: Record<string, OpenAPISchema>;
      }
    ).properties ?? {};
  const inputRequired = (composed.input as { required?: string[] }).required;

  const CreateSchema: OpenAPISchema = {
    type: "object",
    properties: { ...inputProperties },
  };
  if (inputRequired && inputRequired.length > 0) {
    CreateSchema.required = inputRequired;
  }

  // Update schema — same properties but no required (partial update).
  const UpdateSchema: OpenAPISchema = {
    type: "object",
    properties: { ...inputProperties },
  };

  return {
    schemas: {
      [baseName]: ReadSchema,
      [`Create${baseName}`]: CreateSchema,
      [`Update${baseName}`]: UpdateSchema,
    },
    baseName,
  };
}

/**
 * Derive Read + Update schemas for a Single.
 *
 * Singles are singletons: there is no Create variant (the runtime
 * auto-initializes the document on first read) and no Delete. The Read
 * schema includes system fields (id, createdAt, updatedAt, and _status
 * when status: true). SingleConfig has no `timestamps` toggle, so
 * createdAt/updatedAt are always present on the Read schema.
 */
export function deriveSingleSchemas(single: SingleConfig): DerivedSchemas {
  const baseName = collectionSchemaName(single.slug, single.label?.singular);
  const ctx: MappingContext = {
    schemaRef: n => ({ $ref: `#/components/schemas/${n}` }),
    ownerSlug: baseName,
    fieldPath: `singles.${single.slug}`,
  };

  const composed = composeFieldsToObjectSchema(single.fields, ctx);

  // Read schema: user fields + system fields (timestamps always; _status conditional).
  const readProperties: Record<string, OpenAPISchema> = {
    ...((composed.output as { properties?: Record<string, OpenAPISchema> })
      .properties ?? {}),
  };
  readProperties.id = { type: "string", readOnly: true };
  readProperties.createdAt = {
    type: "string",
    format: "date-time",
    readOnly: true,
  };
  readProperties.updatedAt = {
    type: "string",
    format: "date-time",
    readOnly: true,
  };
  if (single.status === true) {
    readProperties._status = {
      type: "string",
      enum: ["draft", "published"],
      readOnly: true,
    };
  }

  const ReadSchema: OpenAPISchema = {
    type: "object",
    properties: readProperties,
  };
  const readRequired = (composed.output as { required?: string[] }).required;
  if (readRequired && readRequired.length > 0) {
    ReadSchema.required = readRequired;
  }

  // Update schema: user fields only, all optional (partial update).
  const inputProperties =
    (composed.input as { properties?: Record<string, OpenAPISchema> })
      .properties ?? {};
  const UpdateSchema: OpenAPISchema = {
    type: "object",
    properties: { ...inputProperties },
  };

  return {
    schemas: {
      [baseName]: ReadSchema,
      [`Update${baseName}`]: UpdateSchema,
    },
    baseName,
  };
}

/**
 * Walk the field tree and register one schema per repeater. Each registered
 * schema is the row body (composed via the standard composer) under the name
 * `<BaseName>__<FieldName>Item`.
 *
 * Recurses into named groups and into nested repeater fields so deeply
 * nested structures are fully covered.
 */
export function deriveNestedItemSchemas(
  owner: { slug: string; fields: readonly FieldConfig[] },
  baseName: string
): Record<string, OpenAPISchema> {
  const schemas: Record<string, OpenAPISchema> = {};
  const baseCtx: MappingContext = {
    schemaRef: n => ({ $ref: `#/components/schemas/${n}` }),
    ownerSlug: baseName,
    fieldPath: owner.slug,
  };

  walkFields(owner.fields, baseCtx.fieldPath, (field, path) => {
    if (field.type !== "repeater") return;
    const repeater = field as {
      name: string;
      fields: readonly FieldConfig[];
    };
    const itemName = `${baseName}__${pascalize(repeater.name)}Item`;
    const itemCtx: MappingContext = {
      ...baseCtx,
      ownerSlug: itemName,
      fieldPath: path,
    };
    const composed = composeFieldsToObjectSchema(repeater.fields, itemCtx);
    // Row items use the output (read) shape — same as input for typical
    // repeaters (no system fields, no password edge cases in practice).
    schemas[itemName] = composed.output;
  });

  return schemas;
}

/**
 * Visit every field in the tree. Calls `visit(field, path)` for each one,
 * then recurses into any nested `fields` array (repeaters and named groups).
 */
function walkFields(
  fields: readonly FieldConfig[],
  basePath: string,
  visit: (field: FieldConfig, path: string) => void
): void {
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (!field) continue;
    const path = `${basePath}.fields[${i}]`;
    visit(field, path);
    if ("fields" in field && Array.isArray(field.fields)) {
      walkFields(field.fields as readonly FieldConfig[], path, visit);
    }
  }
}
