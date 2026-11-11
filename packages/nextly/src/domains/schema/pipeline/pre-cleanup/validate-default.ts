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

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { z } from "zod";

import {
  ICON_ID_MAX_LENGTH,
  ICON_ID_PATTERN,
} from "../../../../collections/fields/types/icon";
import { MYSQL_STORED_DATE } from "../../utils/backfill-default";

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

function schemaForType(type: string, dialect: SupportedDialect): z.ZodTypeAny {
  // SQLite has no boolean or date column: it stores a boolean as 0 or 1 and a date as its epoch
  // seconds, and its driver binds neither a boolean nor a Date. So there a value already in the
  // column's own encoding is the type's value too.
  const sqlite = dialect === "sqlite";
  if (TEXT_TYPES.has(type)) return z.string();
  // A backfilled icon id lands in every existing row, so it must have the
  // shape and length the write path accepts ("lucide:star"); the set is not
  // checked.
  if (type === "icon") {
    return z.string().max(ICON_ID_MAX_LENGTH).regex(ICON_ID_PATTERN);
  }
  if (NUMBER_TYPES.has(type)) return z.number();
  if (BOOL_TYPES.has(type)) {
    return sqlite
      ? z.union([z.boolean(), z.literal(0), z.literal(1)])
      : z.boolean();
  }
  if (DATE_TYPES.has(type)) {
    if (sqlite) {
      return z.union([z.string().datetime(), z.date(), z.number().int()]);
    }
    // A date fill is bound in the form it is stored in (`storedDateValue`):
    // on MySQL its UTC datetime, which is a date there too.
    return dialect === "mysql"
      ? z.union([
          z.string().datetime(),
          z.date(),
          z.string().regex(MYSQL_STORED_DATE),
        ])
      : z.union([z.string().datetime(), z.date()]);
  }
  return z.unknown();
}

export interface ValidateResult {
  success: boolean;
  error?: string;
}

export function validateDefaultValue(
  field: MinimalFieldDef,
  value: unknown,
  dialect: SupportedDialect
): ValidateResult {
  const schema = schemaForType(field.type, dialect);
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { success: false, error: issue?.message ?? "validation failed" };
  }
  return { success: true };
}
