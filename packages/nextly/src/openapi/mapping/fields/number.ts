/**
 * Map `number` fields to OpenAPI numeric schemas.
 *
 * Picks `integer` when the field is clearly integer-only:
 * - `admin.step === 1` (explicit integer increment), OR
 * - both `min` and `max` are integers (range implies whole numbers)
 *
 * Otherwise defaults to `number` (decimals allowed). Authors who want
 * floating-point precision but with bounds at integer values can set an
 * explicit non-integer `admin.step` (e.g. `0.01`) to force `number`.
 *
 * `admin.step` is also emitted as OAS `multipleOf` for non-1 values; `1` is
 * implied by `integer` and omitted to keep the schema clean.
 *
 * `hasMany` flips the schema to an array; `min`/`max` apply to items,
 * `minRows`/`maxRows` apply to the array length (`minItems`/`maxItems`).
 *
 * @module nextly/openapi/mapping/fields/number
 */

import type { NumberFieldConfig } from "../../../collections/fields/types/number";
import type { OpenAPISchema } from "../../types";

import type { FieldMapper, FieldMapperResult } from "./types";

function isIntegerNumber(field: NumberFieldConfig): boolean {
  if (field.admin?.step === 1) return true;
  const min = field.validation?.min ?? field.min;
  const max = field.validation?.max ?? field.max;
  if (min !== undefined && max !== undefined) {
    return Number.isInteger(min) && Number.isInteger(max);
  }
  return false;
}

export const mapNumberField: FieldMapper<NumberFieldConfig> = (
  field
): FieldMapperResult => {
  const description = field.admin?.description ?? field.label;
  const min = field.validation?.min ?? field.min;
  const max = field.validation?.max ?? field.max;
  const step = field.admin?.step;

  const itemType: "integer" | "number" = isIntegerNumber(field)
    ? "integer"
    : "number";
  const itemSchema: OpenAPISchema = { type: itemType };
  if (min !== undefined) itemSchema.minimum = min;
  if (max !== undefined) itemSchema.maximum = max;
  if (step !== undefined && step !== 1) itemSchema.multipleOf = step;

  if (field.hasMany) {
    const arraySchema: OpenAPISchema = {
      type: "array",
      items: { ...itemSchema },
    };
    const minRows = field.validation?.minRows ?? field.minRows;
    const maxRows = field.validation?.maxRows ?? field.maxRows;
    if (minRows !== undefined) arraySchema.minItems = minRows;
    if (maxRows !== undefined) arraySchema.maxItems = maxRows;
    if (description) arraySchema.description = description;
    return {
      input: { ...arraySchema, items: { ...itemSchema } },
      output: { ...arraySchema, items: { ...itemSchema } },
    };
  }

  if (description) itemSchema.description = description;
  return { input: { ...itemSchema }, output: { ...itemSchema } };
};
