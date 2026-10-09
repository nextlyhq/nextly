/**
 * The value a NOT NULL column is backfilled with when it is added to a table
 * that already has rows.
 *
 * One function for the collection and field-group alter paths, which both add
 * such columns: the empty value per field type and dialect is one decision,
 * and two copies of it drift.
 *
 * @module domains/schema/utils/backfill-default
 */
import { pluginEmptyColumnDefault } from "../../../shared/lib/plugin-storage";
import type { SupportedDialect } from "../../../types/database";

import { quoteExpressionSqlDefault } from "./sql-literal";

export interface BackfillDefaultArgs {
  /** The field type, or the storage primitive it resolved to. */
  type: string;
  /** The field as DECLARED, so a contributed type can state its own empty. */
  field: { type?: unknown } | undefined;
  dialect: SupportedDialect;
  /** The caller's own literal renderer for a scalar in a storage type. */
  formatDefaultValue: (value: unknown, storageToken: string) => string;
  /**
   * Field types the caller stores in a JSON array column, backfilled with
   * `[]`. Differs per caller because the column a type maps to does: the
   * collection path stores `chips` as a JSON array, the field-group path as
   * text, where `''` is the empty.
   */
  jsonArrayTypes?: ReadonlySet<string>;
}

/** The SQL default expression a backfilled column of this field type gets. */
export function backfillDefaultForType(args: BackfillDefaultArgs): string {
  const { type, dialect } = args;
  // A contributed type states its own backfill before the primitive's is
  // derived: `{}` satisfies a json column and then fails every read that
  // expects the structure the type actually stores. Read from the field as
  // DECLARED — `type` here may already be the storage primitive, under which
  // the contributed type is not registered and states nothing.
  const contributed = pluginEmptyColumnDefault(args.field ?? { type }, type, {
    json: serialized => quoteExpressionSqlDefault(serialized, dialect),
    literal: (value, storageToken) =>
      args.formatDefaultValue(value, storageToken),
  });
  if (contributed !== undefined) return contributed;

  if (args.jsonArrayTypes?.has(type) === true) {
    return quoteExpressionSqlDefault("[]", dialect);
  }

  switch (type) {
    case "number":
      return "0";
    case "checkbox":
      return dialect === "sqlite" ? "0" : "FALSE";
    case "date":
      if (dialect === "sqlite") {
        return String(Math.floor(Date.now() / 1000));
      }
      return "NOW()";
    case "json":
    case "repeater":
    case "group":
      // These share the blocks column type, so they share its restriction on
      // how a default may be written.
      return quoteExpressionSqlDefault("{}", dialect);
    case "relationship":
    case "upload":
      // Relations are nullable by nature when adding to existing tables.
      return "NULL";
    default:
      // Every text-backed type — text, textarea, email, password, richText,
      // code, select, radio — and anything unrecognised.
      return "''";
  }
}
