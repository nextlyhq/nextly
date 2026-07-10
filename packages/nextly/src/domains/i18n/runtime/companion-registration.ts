/**
 * Runtime registration helper for localized companion `_locales` tables (i18n M3b-2).
 *
 * When a collection/single is localized, its translatable columns live in the migration-owned
 * companion table (Option B). The main runtime Drizzle table omits them (via
 * `generateRuntimeSchema`'s `localized` option); this helper builds the companion's queryable
 * Drizzle table so boot + HMR can register it alongside the main table. The reads that use it
 * land in M4 — until then the registration is dormant but correct.
 *
 * @module domains/i18n/runtime/companion-registration
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { generateCompanionRuntimeSchema } from "../../schema/services/runtime-schema-generator";
import { deriveCompanionSpec } from "../migration/derive-companion-spec";

export interface CompanionRuntimeArgs {
  /** Entity slug (cosmetic for table naming here — `tableName` drives the physical name). */
  slug: string;
  /** Physical main table name (e.g. `dc_pages`). The companion is `<tableName>_locales`. */
  tableName: string;
  /** The entity's field definitions (need `name` + `type` + optional `localized`). */
  fields: { name: string; type: string; localized?: boolean }[];
  dialect: SupportedDialect;
  /** Whether the entity is localized. When false, this returns `null`. */
  localized: boolean;
  /**
   * Default locale — required by `deriveCompanionSpec` but unused for the runtime table
   * (it only affects seeding). Defaults to `"en"`.
   */
  defaultLocale?: string;
  /** Whether the collection has Draft/Published (i18n M6) → companion has a `_status` column. */
  status?: boolean;
}

export interface CompanionRuntimeTable {
  companionTableName: string;
  table: unknown;
}

/**
 * Build the queryable companion `_locales` Drizzle table for a localized entity, or `null`
 * when the entity is not localized / has no localized fields. When the collection has
 * Draft/Published (`status`), the companion carries a per-locale `_status` column (i18n M6).
 */
export function buildCompanionRuntimeTable(
  args: CompanionRuntimeArgs
): CompanionRuntimeTable | null {
  if (!args.localized) return null;
  const spec = deriveCompanionSpec({
    slug: args.slug,
    dbName: args.tableName,
    fields: args.fields,
    dialect: args.dialect,
    defaultLocale: args.defaultLocale ?? "en",
    collectionLocalized: true,
    status: args.status,
  });
  if (!spec) return null;
  const { table } = generateCompanionRuntimeSchema(
    spec.companionTable,
    spec.columns,
    args.dialect,
    { status: args.status === true }
  );
  return { companionTableName: spec.companionTable, table };
}
