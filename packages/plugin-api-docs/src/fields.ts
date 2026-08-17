/**
 * `fields[]` → OpenAPI schema emitter (the plan's "path b").
 *
 * The user's config `fields[]` is the single source of truth for what a
 * collection entry or single document looks like; this emitter turns it into
 * OpenAPI schemas at request time, so the docs describe YOUR collections —
 * add a field to `Posts` and the spec grows it on the next request. No Zod
 * round-trip, no second source of truth to drift.
 *
 * A minimal field view is accepted (name + type + the few options that shape
 * the wire format) so core's full field-config types stay out of the plugin.
 *
 * @module fields
 * @since alpha
 */

/** The minimal field shape the emitter reads from a config. */
export interface FieldLike {
  name: string;
  type: string;
  required?: boolean;
  localized?: boolean;
  hasMany?: boolean;
  options?: Array<{ label?: string; value: string | number }>;
  fields?: FieldLike[]; // repeater/group containers
  component?: string;
  components?: string[];
  defaultValue?: unknown;
}

/** A collection/single surface as read from the host config. */
export interface ContentSurfaceLike {
  slug: string;
  labels?: { singular?: string; plural?: string };
  fields: FieldLike[];
}

export interface OpenApiSchema {
  [k: string]: unknown;
}

/** Component schemas collected while emitting, keyed by component slug. */
export interface ComponentSchemas {
  schemas: Record<string, OpenApiSchema>;
  /** Field names referencing each component (for descriptions). */
  refs: Map<string, string[]>;
}

/** Options that relax required fields for PATCH (update) bodies. */
export interface EmitOptions {
  /** PATCH semantics: every field optional. */
  allOptional?: boolean;
}

function scalarSchema(field: FieldLike): OpenApiSchema {
  switch (field.type) {
    case "text":
    case "textarea":
    case "richText":
    case "code":
    case "password":
      return { type: "string" };
    case "email":
      return { type: "string", format: "email" };
    case "number":
      return { type: "number" };
    case "checkbox":
      return { type: "boolean" };
    case "date":
      return { type: "string", format: "date-time" };
    case "select":
    case "radio": {
      const values = (field.options ?? []).map(o => o.value);
      return values.length > 0
        ? {
            type: typeof values[0] === "number" ? "integer" : "string",
            enum: values,
          }
        : { type: "string" };
    }
    case "chips":
      return { type: "array", items: { type: "string" } };
    case "json":
      return { type: "object", additionalProperties: true };
    // relationship + upload carry the target's id (expanded reads are a
    // query-time projection, not the stored shape); hasMany stores an ARRAY of
    // those ids — the stored wire shape, which is what a schema documents.
    case "relationship":
    case "upload": {
      const id = { type: "string" };
      return field.hasMany ? { type: "array", items: id } : id;
    }
    // Plugin-contributed types: unknown wire shape, open object.
    default:
      return {
        type: "object",
        additionalProperties: true,
        description: `Plugin field type "${field.type}".`,
      };
  }
}

/**
 * Emit the properties+required pair for one field list. Container types
 * (repeater/group) recurse; component fields collect into `components` for the
 * caller to register as named schemas.
 */
function emitProperties(
  fields: readonly FieldLike[],
  components: ComponentSchemas,
  opts: EmitOptions
): { properties: Record<string, OpenApiSchema>; required: string[] } {
  const properties: Record<string, OpenApiSchema> = {};
  const required: string[] = [];
  for (const field of fields) {
    let schema: OpenApiSchema;
    if (field.type === "repeater" || field.type === "group") {
      const inner = emitProperties(field.fields ?? [], components, opts);
      schema = {
        type: "object",
        properties: inner.properties,
        ...(inner.required.length > 0 ? { required: inner.required } : {}),
        additionalProperties: false,
      };
      if (field.type === "repeater") {
        schema = { type: "array", items: schema };
      }
    } else if (
      field.type === "component" &&
      (field.component ?? field.components?.[0])
    ) {
      const slug = (field.component ?? field.components?.[0]) as string;
      schema = { $ref: `#/components/schemas/Component_${slug}` };
      const names = components.refs.get(slug) ?? [];
      names.push(field.name);
      components.refs.set(slug, names);
      components.schemas[`Component_${slug}`] ??= {
        type: "object",
        additionalProperties: true,
        description: `Fields of the "${slug}" field group (schema defined in the app config).`,
      };
    } else {
      schema = scalarSchema(field);
    }
    if (field.localized) {
      schema = {
        oneOf: [
          schema,
          {
            type: "object",
            additionalProperties: schema,
            description: "Localized values keyed by locale.",
          },
        ],
      };
    }
    properties[field.name] = schema;
    if (field.required && !opts.allOptional) required.push(field.name);
  }
  return { properties, required };
}

/** Emit a full object schema for one field list. */
export function fieldsToSchema(
  fields: readonly FieldLike[],
  components: ComponentSchemas,
  opts: EmitOptions = {}
): OpenApiSchema {
  const { properties, required } = emitProperties(fields, components, opts);
  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  };
}

/** Wrap a document schema with the system columns every entry carries. */
export function entrySchema(
  fields: readonly FieldLike[],
  components: ComponentSchemas,
  opts: EmitOptions = {}
): OpenApiSchema {
  const base = fieldsToSchema(fields, components, opts) as {
    properties: Record<string, OpenApiSchema>;
    required?: string[];
  };
  return {
    type: "object",
    properties: {
      id: { type: "string", description: "Entry id." },
      ...base.properties,
      status: {
        type: "string",
        enum: ["draft", "published"],
        description: "Publishing status (collections with drafts).",
      },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
    },
    ...(base.required
      ? { required: ["id", ...base.required] }
      : { required: ["id"] }),
  };
}
