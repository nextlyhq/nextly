// Zod-based validation for provide_default values.
//
// We don't reach into the field-config Zod schemas at this stage because
// those schemas validate the FULL field record (with all metadata),
// whereas provide_default validates a single VALUE for that field's type.
// The minimal type->schema mapping below mirrors the runtime allow-list
// from runtime-schema-generator.ts so the same set of types is accepted.
//
// Unknown types fall through with z.unknown() so user-defined plugin
// fields don't block the apply — better to attempt the UPDATE and let
// the database reject incompatible values than to refuse upfront.

import { z } from "zod";

interface MinimalFieldDef {
  name: string;
  type: string;
}

const TEXT_TYPES = new Set([
  "text",
  "email",
  "textarea",
  "richText",
  "code",
  "url",
  "slug",
]);
const NUMBER_TYPES = new Set(["number", "int", "integer"]);
const BOOL_TYPES = new Set(["checkbox", "boolean"]);
const DATE_TYPES = new Set(["date", "datetime", "timestamp"]);

function schemaForType(type: string): z.ZodTypeAny {
  if (TEXT_TYPES.has(type)) return z.string();
  if (NUMBER_TYPES.has(type)) return z.number();
  if (BOOL_TYPES.has(type)) return z.boolean();
  if (DATE_TYPES.has(type)) {
    return z.union([z.string().datetime(), z.date()]);
  }
  return z.unknown();
}

export interface ValidateResult {
  success: boolean;
  error?: string;
}

export function validateDefaultValue(
  field: MinimalFieldDef,
  value: unknown
): ValidateResult {
  const schema = schemaForType(field.type);
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { success: false, error: issue?.message ?? "validation failed" };
  }
  return { success: true };
}
