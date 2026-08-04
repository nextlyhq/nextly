import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { ColumnOrigin } from "../../schema/services/field-column-descriptor";
import { resolveCollectionTableName } from "../../schema/utils/resolve-table-name";
import { isFieldLocalized } from "../classify-fields";

import { fieldToLocalizedColumnSpec } from "./field-to-column-spec";
import type { CompanionMigrationSpec, LocalizedColumnSpec } from "./types";

interface FieldLike {
  name: string;
  type: string;
  localized?: boolean;
}

interface DeriveArgs {
  slug: string;
  dbName?: string;
  fields: FieldLike[];
  dialect: SupportedDialect;
  defaultLocale: string;
  collectionLocalized: boolean;
  /** Whether the collection has Draft/Published (i18n M6) → companion gets a per-locale `_status`. */
  status?: boolean;
  /**
   * Which builder made the main table. A companion column mirrors the main table's, so it is
   * described as whatever built that one; deciding it locally left a translatable field bounded on
   * the companion while the same declaration was unbounded on the main table.
   */
  builtBy: ColumnOrigin;
}

/** Parent-id DDL type must match the main table's `id` column. */
function parentIdType(dialect: SupportedDialect): string {
  return dialect === "mysql" ? "VARCHAR(36)" : "TEXT";
}

/**
 * Build an M1 `CompanionMigrationSpec` for a collection, or `null` when the collection is
 * not localized / has no localized fields. Bridges M2 classification (`isFieldLocalized`)
 * and the storage descriptor into the shape M1's migration generator consumes.
 */
export function deriveCompanionSpec(
  args: DeriveArgs
): CompanionMigrationSpec | null {
  if (!args.collectionLocalized) return null;

  const columns: LocalizedColumnSpec[] = [];
  for (const f of args.fields) {
    if (!isFieldLocalized(f, true)) continue;
    const col = fieldToLocalizedColumnSpec(f, args.dialect, args.builtBy);
    if (col) columns.push(col);
  }
  if (columns.length === 0) return null;

  // Use the caller-supplied physical table name verbatim (all callers pass the resolved
  // `tableName`, e.g. `dc_authors`, `single_site_settings`, `comp_seo`). Only fall back to
  // the `dc_` collection convention when no dbName is given. Do NOT route through
  // resolveCollectionTableName here — it force-prepends `dc_`, which would double-prefix a
  // single/component companion (e.g. `dc_single_site_settings_locales`).
  const mainTable =
    args.dbName ?? resolveCollectionTableName(args.slug, args.dbName);
  return {
    dialect: args.dialect,
    collection: args.slug,
    mainTable,
    companionTable: `${mainTable}_locales`,
    defaultLocale: args.defaultLocale,
    parentIdType: parentIdType(args.dialect),
    columns,
    status: args.status === true,
  };
}
