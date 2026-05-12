/**
 * Map `select` fields to OpenAPI string-with-enum schemas.
 *
 * `hasMany: true` flips the schema to an array of enum strings. The enum
 * itself is the list of `option.value`s — labels are display-only and not
 * surfaced in the spec (clients sending an HTTP request send the value).
 *
 * `SelectFieldConfig` has no `validation` object and no quantity constraints
 * on `hasMany` (`minRows`/`maxRows` don't exist here), so the mapper has
 * fewer knobs than `text` or `number`.
 *
 * Spec: §7.1 row "select".
 *
 * @module nextly/openapi/mapping/fields/select
 */

import type { SelectFieldConfig } from "../../../collections/fields/types/select";
import type { OpenAPISchema } from "../../types";

import type { FieldMapper, FieldMapperResult } from "./types";

export const mapSelectField: FieldMapper<SelectFieldConfig> = (
  field
): FieldMapperResult => {
  const description = field.admin?.description ?? field.label;
  const enumValues = field.options.map(o => o.value);

  const itemSchema: OpenAPISchema = { type: "string", enum: enumValues };

  if (field.hasMany) {
    const arraySchema: OpenAPISchema = {
      type: "array",
      items: { ...itemSchema },
    };
    if (description) arraySchema.description = description;
    return {
      input: { ...arraySchema, items: { ...itemSchema } },
      output: { ...arraySchema, items: { ...itemSchema } },
    };
  }

  if (description) itemSchema.description = description;
  return { input: { ...itemSchema }, output: { ...itemSchema } };
};
