/**
 * Compose a list of FieldConfigs into a JSON Schema object body.
 *
 * Walks each field, looks up the appropriate mapper from the registry,
 * and assembles `properties` + `required` for both the input (request body)
 * and output (response body) variants. Used by:
 *   - `group.ts` — to compose nested-group object schemas
 *   - `repeater.ts` — to compose row-item schemas
 *   - `deriveCollectionSchemas` — to build the per-collection schemas
 *
 * **Unnamed-group flattening:** `GroupFieldConfig.name` is optional. When a
 * group has no `name`, it's a *presentational* group — its fields are stored
 * at the parent level rather than under a nested property. This composer
 * handles that by recursively spreading the group's fields into the current
 * object, never invoking the group's mapper for unnamed groups.
 *
 * **Password omission:** `password` fields are always present in the
 * *input* (Create/Update) schema but omitted from the *output* (Read)
 * schema. This is the single asymmetry the composer enforces.
 *
 * @module nextly/openapi/mapping/fields/_compose
 */

import type { FieldConfig } from "../../../collections/fields/types";
import type { OpenAPISchema } from "../../types";

import type { MappingContext } from "./types";

import { fieldMappers } from "./index";

export interface ComposedObjectSchemas {
  input: OpenAPISchema;
  output: OpenAPISchema;
}

export function composeFieldsToObjectSchema(
  fields: readonly FieldConfig[],
  ctx: MappingContext
): ComposedObjectSchemas {
  const inputProperties: Record<string, OpenAPISchema> = {};
  const outputProperties: Record<string, OpenAPISchema> = {};
  const inputRequired: string[] = [];
  const outputRequired: string[] = [];

  appendFields(
    fields,
    ctx,
    inputProperties,
    outputProperties,
    inputRequired,
    outputRequired
  );

  const input: OpenAPISchema = {
    type: "object",
    properties: inputProperties,
  };
  const output: OpenAPISchema = {
    type: "object",
    properties: outputProperties,
  };
  if (inputRequired.length) input.required = inputRequired;
  if (outputRequired.length) output.required = outputRequired;

  return { input, output };
}

/**
 * Append fields into existing property maps. Used both by the top-level
 * composer above and recursively when flattening unnamed groups.
 */
function appendFields(
  fields: readonly FieldConfig[],
  ctx: MappingContext,
  inputProperties: Record<string, OpenAPISchema>,
  outputProperties: Record<string, OpenAPISchema>,
  inputRequired: string[],
  outputRequired: string[]
): void {
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (!field) continue;
    const childPath = `${ctx.fieldPath}.fields[${i}]`;

    // Unnamed groups (`{ type: 'group', name: undefined, fields: [...] }`)
    // flatten their children into the parent object. The group's own mapper
    // is never invoked in this case.
    if (field.type === "group" && !("name" in field && field.name)) {
      const groupFields = (field as { fields?: readonly FieldConfig[] }).fields;
      if (groupFields) {
        appendFields(
          groupFields,
          { ...ctx, fieldPath: childPath },
          inputProperties,
          outputProperties,
          inputRequired,
          outputRequired
        );
      }
      continue;
    }

    // Virtual `join` fields are read-only and have no input shape;
    // they're handled by the collection-level composer. The mapper
    // registry currently has no entry for `join`, so we just skip with
    // a warning instead of crashing.
    const mapper = fieldMappers[field.type];
    if (!mapper) {
      console.warn(
        `[openapi] no mapper for field type '${field.type}' at ${childPath}`
      );
      continue;
    }

    const childCtx: MappingContext = { ...ctx, fieldPath: childPath };
    const { input, output } = mapper(field, childCtx);
    const name = (field as { name: string }).name;

    inputProperties[name] = input;
    // password fields are write-only — they appear in the input schema
    // but never in the output schema. This is the lone asymmetry the
    // composer enforces; all other fields produce symmetric variants.
    if (field.type !== "password") {
      outputProperties[name] = output;
    }

    if ("required" in field && field.required === true) {
      inputRequired.push(name);
      if (field.type !== "password") outputRequired.push(name);
    }
  }
}
