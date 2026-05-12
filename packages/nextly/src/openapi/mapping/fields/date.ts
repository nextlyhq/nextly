/**
 * Map `date` fields to OpenAPI string schemas with the appropriate format.
 *
 * The `pickerAppearance` (UI hint) drives the OAS `format`:
 * - `dayOnly` → `"date"` (YYYY-MM-DD)
 * - `timeOnly` → `"time"` (HH:mm:ss)
 * - `dayAndTime` / `monthOnly` / undefined → `"date-time"` (ISO 8601)
 *
 * The picker hint itself is also emitted as `x-nextly-picker-appearance` so
 * docs renderers / SDK generators can preserve UI intent. The runtime never
 * cares — Nextly's `DateFieldValue` is always `string | Date | null`.
 *
 * Note: `DateFieldConfig` does NOT have a `validation` object. Constraints
 * live at `admin.date.minDate` / `maxDate`, which describe selectable
 * ranges in the UI but are not surfaced as OAS constraints in v1 (they'd
 * map to `minimum`/`maximum` only for `format: 'date'`, and the picker
 * itself enforces them — server validation happens via Zod).
 *
 * Spec: §7.1 row "date".
 *
 * @module nextly/openapi/mapping/fields/date
 */

import type {
  DateFieldConfig,
  DatePickerAppearance,
} from "../../../collections/fields/types/date";
import type { OpenAPISchema } from "../../types";

import type { FieldMapper, FieldMapperResult } from "./types";

function formatForPicker(
  appearance: DatePickerAppearance | undefined
): "date" | "time" | "date-time" {
  if (appearance === "dayOnly") return "date";
  if (appearance === "timeOnly") return "time";
  // dayAndTime, monthOnly, or undefined.
  return "date-time";
}

export const mapDateField: FieldMapper<DateFieldConfig> = (
  field
): FieldMapperResult => {
  const description = field.admin?.description ?? field.label;
  const appearance = field.admin?.date?.pickerAppearance;

  const schema: OpenAPISchema = {
    type: "string",
    format: formatForPicker(appearance),
  };
  if (description) schema.description = description;
  if (appearance !== undefined) {
    (schema as Record<string, unknown>)["x-nextly-picker-appearance"] =
      appearance;
  }

  return { input: { ...schema }, output: { ...schema } };
};
