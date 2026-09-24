/**
 * An extension column as a {@link ColumnDescriptor}, and nothing else.
 *
 * Split out of `compile.ts` for the same reason `active-schema.ts` was split
 * out of the builder: the runtime schema generator has to render a
 * contributed column on an entity table, and `compile.ts` imports the
 * generator — so reaching for it there would close the loop. This module
 * imports only the renderer, which the generator already depends on.
 *
 * @module domains/schema/extension/column-descriptor
 * @since 1.0.0
 */
import type { SupportedDialect } from "../../../database/schema-registry";
import type { ColumnDescriptor } from "../services/field-column-descriptor";
import { renderDialectType } from "../services/field-column-descriptor";

import type { ExtensionColumn } from "./types";

/** The descriptor an extension column becomes, so it renders like any other. */
export function toColumnDescriptor(
  column: ExtensionColumn,
  dialect: SupportedDialect
): ColumnDescriptor {
  return {
    name: column.name,
    dialectType: renderDialectType(column.kind, dialect, {
      ...(column.length !== undefined ? { length: column.length } : {}),
      ...(column.precision !== undefined
        ? { precision: column.precision }
        : {}),
      ...(column.scale !== undefined ? { scale: column.scale } : {}),
    }),
    nullable: column.nullable,
    kind: column.kind,
    ...(column.length !== undefined ? { length: column.length } : {}),
    ...(column.precision !== undefined ? { precision: column.precision } : {}),
    ...(column.scale !== undefined ? { scale: column.scale } : {}),
  };
}
