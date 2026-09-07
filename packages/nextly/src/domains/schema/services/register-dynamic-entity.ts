/**
 * Register one dynamic entity's runtime schema — main table AND companion.
 *
 * 🔴 A localized collection or single is TWO Drizzle tables. The main table
 * omits the translatable columns, which live in `<table>_locales`, so a caller
 * that registers only the main one leaves every localized read and write
 * addressing a table without the columns it needs. The two are one
 * registration, and this is the only place that says so.
 *
 * Extracted because it had two copies and needed a third. `registerServices`
 * spelled it once for `dynamic_collections` and again for `dynamic_singles`,
 * differing only in which owner `builtByFor` is asked about — and the boot-time
 * reload that refreshes those registries after a migration had a narrower
 * version again, which registered the main table and silently left a stale
 * companion behind. Three spellings of one rule is how the third came to be
 * missing half of it.
 *
 * The field-group equivalent already lives beside it as
 * `domains/field-groups/services/register-field-group-schemas`.
 *
 * @module domains/schema/services/register-dynamic-entity
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { SchemaRegistry } from "../../../database/schema-registry";
import type { FieldDefinition } from "../../../schemas/dynamic-collections/legacy-types";
import { builtByFor } from "../pipeline/registered-collections";

export interface RegisterDynamicEntityArgs {
  adapter: DrizzleAdapter;
  registry: SchemaRegistry;
  dialect: SupportedDialect;
  /** Which registry the row came from, which decides whose sizing rules apply. */
  kind: "collection" | "single";
  tableName: string;
  fields: FieldDefinition[];
  status: boolean;
  localized: boolean;
  /**
   * Ownership as the registry reported it; `undefined` where it is too old to
   * say. These registries hold code-first and plugin rows as well as Builder
   * ones, and their creators size a text column differently, so the row's own
   * ownership decides rather than the caller.
   */
  builderOwned: boolean | undefined;
}

export async function registerDynamicEntitySchema(
  args: RegisterDynamicEntityArgs
): Promise<void> {
  const { adapter, registry, dialect, tableName, fields, status, localized } =
    args;

  const { generateRuntimeSchema } = await import("./runtime-schema-generator");
  // A localized entity omits its translatable columns from the main runtime
  // table -- they live in the companion -- which mirrors what the migration did.
  const { table } = generateRuntimeSchema(tableName, fields, dialect, {
    status,
    localized,
  });
  registry.registerDynamicSchema(tableName, table);

  if (!localized) return;

  // Created here if a migration has not already (idempotent), so a code-first
  // localized entity works without a manual migrate.
  const { ensureCompanionTable } = await import(
    "../../i18n/runtime/companion-io"
  );
  await ensureCompanionTable(adapter, {
    builtBy: builtByFor(args.kind, args.builderOwned),
    slug: tableName,
    tableName,
    fields,
    dialect,
    status,
  });

  const { buildCompanionRuntimeTable } = await import(
    "../../i18n/runtime/companion-registration"
  );
  const companion = buildCompanionRuntimeTable({
    slug: tableName,
    tableName,
    fields,
    dialect,
    localized: true,
    // Carries `_status`, so a Draft/Published localized entity's registered
    // companion matches what `loadCompanionSchema` expects.
    status,
  });
  if (companion) {
    registry.registerDynamicSchema(
      companion.companionTableName,
      companion.table
    );
  }
}
