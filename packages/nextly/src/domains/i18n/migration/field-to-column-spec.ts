import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import {
  getColumnDescriptor,
  type ColumnOrigin,
} from "../../schema/services/field-column-descriptor";

import type { LocalizedColumnSpec } from "./types";

/** Minimal field shape — cast to FieldDefinition for the descriptor call. */
interface FieldLike {
  name: string;
  type: string;
  length?: number;
}

/**
 * Map a field to an M1 `LocalizedColumnSpec` via the storage descriptor.
 * The descriptor's `ColumnKind` union has `varchar`/`skip` which M1's kind lacks:
 * `varchar` collapses to `text`; `skip`/null fields yield `null` (no companion column).
 */
export function fieldToLocalizedColumnSpec(
  field: FieldLike,
  dialect: SupportedDialect,
  // A companion column mirrors the main table's, so it is described as whatever built that table.
  // Deciding it here instead left a translatable field bounded on the companion while the same
  // declaration was unbounded on the main table, so a value saved in one language was refused in
  // another.
  builtBy: ColumnOrigin
): LocalizedColumnSpec | null {
  const desc = getColumnDescriptor(field as FieldDefinition, dialect, builtBy);
  if (!desc || desc.kind === "skip") return null;
  const kind = desc.kind === "varchar" ? "text" : desc.kind;
  return {
    name: desc.name,
    kind,
    ...(desc.length ? { length: desc.length } : {}),
    // Carry precision/scale so a localized decimal keeps exact numeric storage
    // in the companion table (main added `decimal` field storage).
    ...(kind === "decimal"
      ? { precision: desc.precision, scale: desc.scale }
      : {}),
  };
}
