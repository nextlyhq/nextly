// The column the user-extension builder gives a user field in `user_ext`.
//
// That builder maps field types with rules of its own, which the column descriptor does not share,
// so the column is asked of the builder itself rather than restated here: its type from
// `columnTypeFor`, the type its CREATE TABLE and ADD COLUMN statements spell, and its name from
// `userFieldColumnName`, the name those statements use. Nullability is the CREATE TABLE's, which
// writes NOT NULL for a required field; that its ADD COLUMN does not is a difference the cause
// names as the current builder's.
//
// @module domains/schema/repair-columns/user-field-columns

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import type { UserFieldConfig } from "../../../users/config/types";
import { userFieldColumnName } from "../../../users/config/validate-user-config";
import { UserExtSchemaService } from "../../users/services/user-ext-schema-service";
import type { SupportedDialect } from "../services/field-column-descriptor";

import type { ColumnState } from "./types";

/**
 * One builder per dialect, shared by every user field of a run. It keeps no state a call changes:
 * without a definitions service it holds only its dialect.
 */
const builders = new Map<SupportedDialect, UserExtSchemaService>();

function builderFor(dialect: SupportedDialect): UserExtSchemaService {
  let builder = builders.get(dialect);
  if (builder === undefined) {
    builder = new UserExtSchemaService(dialect);
    builders.set(dialect, builder);
  }
  return builder;
}

/**
 * The column the user-extension builder creates for a user field, or null where it creates none.
 * The type is lower-cased to read like every other expected type in the report; the comparison
 * ignores case either way.
 */
export function userFieldColumn(
  field: FieldDefinition,
  dialect: SupportedDialect
): (ColumnState & { name: string }) | null {
  // A stored user field is a user field configuration; the field list carries it as a field.
  const type = builderFor(dialect).columnTypeFor(
    field as unknown as UserFieldConfig
  );
  if (type === null) return null;
  return {
    name: userFieldColumnName(field.name),
    type: type.toLowerCase(),
    nullable: field.required !== true,
  };
}
