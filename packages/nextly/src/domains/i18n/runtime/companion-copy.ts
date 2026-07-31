/**
 * Moving default-locale values between an entity's main table and its companion.
 *
 * The same two copies are expressed twice in this codebase, on purpose. `generate-down` and
 * `generate-up` emit them as SQL TEXT, because a migration file has to carry SQL. These are the
 * runtime paths, which are not files, so they go through the query builder: identifiers come from
 * the generated table objects rather than hand-quoting, and the locale is bound rather than
 * embedded.
 *
 * Both directions live here so the pair cannot drift, and so the one piece of knowledge they share
 * — that the main table object is keyed by FIELD name while the companion is keyed by physical
 * COLUMN name — is written down once.
 *
 * @module domains/i18n/runtime/companion-copy
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { and, eq, sql } from "drizzle-orm";

import { COMPANION_DEFAULT_STATUS } from "../migration/generate-up";

import type { CompanionIntrospectAdapter } from "./companion-io";
import { buildCompanionRuntimeTable } from "./companion-registration";

/** Minimal field shape these copies need. */
export interface CopyableField {
  name: string;
  type: string;
  localized?: boolean;
}

interface CopyArgs {
  tableName: string;
  companionTableName: string;
  fields: CopyableField[];
  dialect: SupportedDialect;
  locale: string;
  /** Physical column names, already narrowed to those present on both tables. */
  columns: readonly string[];
  /**
   * Whether the entity has Draft/Published, so the generated tables carry their status columns.
   *
   * The generator injects `status` on main and `_status` on the companion only when told to, and a
   * copy that reads either of them needs the column object to exist.
   */
  status?: boolean;
}

/**
 * The two table objects plus the field/column pairs that exist on both sides.
 *
 * Returns null when there is nothing to copy, which is the caller's cue to do nothing rather than
 * issue an empty statement.
 */
async function resolveCopyShape(args: CopyArgs): Promise<{
  mainTable: unknown;
  companionTable: unknown;
  main: Record<string, unknown>;
  companion: Record<string, unknown>;
  pairs: { field: string; column: string }[];
} | null> {
  const { generateRuntimeSchema } = await import(
    "../../schema/services/runtime-schema-generator"
  );
  const { fieldToLocalizedColumnSpec } = await import(
    "../migration/field-to-column-spec"
  );

  // The main table WITH its translatable columns: they are what one direction writes into and the
  // other reads from, and the generator omits them only when told the entity is localized.
  const mainTable = generateRuntimeSchema(
    args.tableName,
    args.fields as Parameters<typeof generateRuntimeSchema>[1],
    args.dialect,
    { status: args.status === true }
  ).table;
  // Every field is offered as translatable, because turning localization off usually clears the
  // per-field flags and the companion's physical columns are what actually decide. The
  // intersection was resolved before this call.
  const companion = buildCompanionRuntimeTable({
    slug: args.tableName,
    tableName: args.tableName,
    fields: args.fields.map(f => ({ ...f, localized: true })),
    dialect: args.dialect,
    localized: true,
    status: args.status === true,
  });
  if (!companion) return null;

  // The main table object is keyed by FIELD name while the companion is keyed by physical COLUMN
  // name, so `subTitle` and `sub_title` are the same value under two keys. Paired through the same
  // descriptor the columns were created from rather than by re-deriving the conversion.
  const wanted = new Set(args.columns);
  const pairs = args.fields
    .map(field => ({
      field: field.name,
      column: fieldToLocalizedColumnSpec(field, args.dialect)?.name,
    }))
    .filter(
      (p): p is { field: string; column: string } =>
        typeof p.column === "string" && wanted.has(p.column)
    );
  if (pairs.length === 0) return null;

  return {
    mainTable,
    companionTable: companion.table,
    main: mainTable as Record<string, unknown>,
    companion: companion.table as Record<string, unknown>,
    pairs,
  };
}

/**
 * The slice of Drizzle this copy drives.
 *
 * Declared structurally, the way the companion read helpers declare theirs, because the table
 * objects are built per entity at runtime and their dialect-specific types differ — naming only
 * the calls used keeps the dialect out of the port and needs no `any`.
 */
interface UpdatableDb {
  update(table: unknown): {
    set(values: Record<string, unknown>): {
      where(condition: unknown): Promise<unknown>;
    };
  };
}

/**
 * Copy the default locale's companion values back onto the main row, through Drizzle.
 *
 * The equivalent statement is also produced as text by `buildDefaultLocaleRestoreStatements`, for
 * the disable MIGRATION — a file has to carry SQL. This path is not a file, so it goes through the
 * query builder: identifiers come from the generated table objects rather than hand-quoting, and
 * the locale is bound rather than embedded.
 *
 * One statement covering every column. Several can land half-way, leaving main carrying a mixture
 * of restored and pre-localization values with nothing recording that a restore was attempted —
 * after which the app serves that mixture, accepts edits on it, and the next pass overwrites them
 * from the now-stale companion.
 *
 * `WHERE EXISTS` matters as much: without it a row that has no companion row in the default locale
 * — an entry authored only in another language — assigns SQL NULL, so restoring would blank the
 * main column instead of leaving it alone. There is nothing to restore for such a row.
 */
/**
 * Copy the default locale's companion values back onto the main row.
 *
 * ONE statement covering every column. Several can land half-way, leaving main carrying a mixture
 * of restored and pre-localization values with nothing recording that a restore was attempted —
 * after which the app serves that mixture, accepts edits on it, and the next pass overwrites them
 * from the now-stale companion.
 *
 * `WHERE EXISTS` matters as much: without it a row with no companion row in this locale — an entry
 * authored only in another language — assigns SQL NULL, so restoring would blank the main column
 * instead of leaving it alone. There is nothing to restore for such a row.
 */
export async function copyDefaultLocaleOntoMain(
  adapter: CompanionIntrospectAdapter,
  args: CopyArgs
): Promise<void> {
  const shape = await resolveCopyShape(args);
  if (!shape) return;

  const matches = and(
    eq(shape.companion._parent as never, shape.main.id as never),
    eq(shape.companion._locale as never, args.locale)
  );
  const values: Record<string, unknown> = {};
  for (const pair of shape.pairs) {
    values[pair.field] =
      sql`(select ${shape.companion[pair.column]} from ${shape.companionTable} where ${matches})`;
  }

  await adapter
    .getDrizzle<UpdatableDb>()
    .update(shape.mainTable)
    .set(values)
    .where(
      sql`exists (select 1 from ${shape.companionTable} where ${matches})`
    );
}

/**
 * Overwrite this locale's companion values from the main row — the reverse direction.
 *
 * Needed for the one case where the seed's usual guarded insert does the wrong thing: re-enabling
 * localization on an entity whose companion survived a previous disable. Those rows are real, so an
 * insert guarded on their absence skips them, and they are stale, because main has been
 * authoritative ever since. Rows the companion does not have yet are not this statement's job — the
 * guarded insert that follows adds them.
 *
 * `refreshStatus` carries the main row's `status` across too. Publishing state moves while
 * localization is off, and the surviving companion row keeps whatever status it held when it was
 * last the authority. Defaulted, because the companion's `_status` is NOT NULL while main's
 * `status` need not be.
 */
export async function refreshDefaultLocaleFromMain(
  adapter: CompanionIntrospectAdapter,
  args: CopyArgs & { refreshStatus?: boolean }
): Promise<void> {
  const shape = await resolveCopyShape(args);
  if (!shape && !args.refreshStatus) return;
  const resolved = shape ?? (await resolveCopyShape({ ...args, columns: [] }));
  if (!resolved) return;

  const correlate = eq(
    resolved.main.id as never,
    resolved.companion._parent as never
  );
  const values: Record<string, unknown> = {};
  for (const pair of resolved.pairs) {
    values[pair.field === pair.column ? pair.column : pair.column] =
      sql`(select ${resolved.main[pair.field]} from ${resolved.mainTable} where ${correlate})`;
  }
  if (args.refreshStatus) {
    values._status = sql`coalesce((select ${resolved.main.status} from ${resolved.mainTable} where ${correlate}), ${COMPANION_DEFAULT_STATUS})`;
  }
  if (Object.keys(values).length === 0) return;

  await adapter
    .getDrizzle<UpdatableDb>()
    .update(resolved.companionTable)
    .set(values)
    .where(eq(resolved.companion._locale as never, args.locale));
}

/**
 * The slice of Drizzle these copies drive.
 *
 * Declared structurally, the way the companion read helpers declare theirs, because the table
 * objects are built per entity at runtime and their dialect-specific types differ — naming only the
 * calls used keeps the dialect out of the port and needs no `any`.
 */
interface UpdatableDb {
  update(table: unknown): {
    set(values: Record<string, unknown>): {
      where(condition: unknown): Promise<unknown>;
    };
  };
}
