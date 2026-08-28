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

import { nextlyMeta as nextlyMetaMysql } from "../../../schemas/nextly-meta/mysql";
import { nextlyMeta as nextlyMetaPg } from "../../../schemas/nextly-meta/postgres";
import { nextlyMeta as nextlyMetaSqlite } from "../../../schemas/nextly-meta/sqlite";
import { COMPANION_UPDATED_AT_COLUMN } from "../companion-columns";
import { isMissingColumnError } from "../companion-join";
import { COMPANION_DEFAULT_STATUS } from "../migration/generate-up";

import type { CompanionIntrospectAdapter } from "./companion-io";
import { buildCompanionRuntimeTable } from "./companion-registration";
import { buildCompanionStampTable } from "./companion-stamp-table";

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
 * Returns null only when the companion cannot be described at all. An empty `pairs` is a real
 * answer, not a failure: an entity can have no translatable VALUE column on both sides and still
 * owe a publishing-status copy, and collapsing that onto null would silently skip it.
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
      column: fieldToLocalizedColumnSpec(
        field,
        args.dialect,
        // Only the column NAME is read here, to move values between two tables that already exist.
        // The width plays no part in that, so this states the reading that renders no new column.
        "codeFirst"
      )?.name,
    }))
    .filter(
      (p): p is { field: string; column: string } =>
        typeof p.column === "string" && wanted.has(p.column)
    );

  return {
    mainTable,
    companionTable: companion.table,
    main: mainTable as Record<string, unknown>,
    companion: companion.table as Record<string, unknown>,
    pairs,
  };
}

/** The `nextly_meta` table for a dialect, so both guarded copies name the same one. */
function metaTableFor(dialect: SupportedDialect) {
  if (dialect === "postgresql") return nextlyMetaPg;
  if (dialect === "mysql") return nextlyMetaMysql;
  return nextlyMetaSqlite;
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
 * ONE statement covering every column. Several can land half-way, leaving main carrying a mixture
 * of restored and pre-localization values with nothing recording that a restore was attempted —
 * after which the app serves that mixture, accepts edits on it, and the next pass overwrites them
 * from the now-stale companion.
 *
 * `WHERE EXISTS` matters as much: without it a row with no companion row in this locale — an entry
 * authored only in another language — assigns SQL NULL, so restoring would blank the main column
 * instead of leaving it alone. There is nothing to restore for such a row.
 *
 * `guard` is the transition this copy runs under, carried into the statement for the same reason
 * the re-enable refresh carries its claim: this is a destructive write. Two processes disabling the
 * same entity can both read one `seeded` marker and reach here; if the first copies, records
 * `restored` and publishes the non-localized configuration, edits land on main and the second's
 * copy overwrites them from a companion that is stale by then. Detecting the lost comparison
 * afterwards cannot recover the overwritten edit, so the condition travels with the update.
 *
 * `status` carries the selected row's `_status` back with its values. While an entity is
 * localized, publishing is per locale: a publish under a non-default locale updates that
 * companion row and deliberately leaves main alone. Restoring the values without the status they
 * were published under is what makes draft content public, or makes published content vanish.
 */
export async function copyDefaultLocaleOntoMain(
  adapter: CompanionIntrospectAdapter,
  args: CopyArgs & {
    fallbackLocale?: string;
    guard?: { key: string; value: string };
  }
): Promise<void> {
  const shape = await resolveCopyShape(args);
  if (!shape) return;
  if (shape.pairs.length === 0 && args.status !== true) return;

  // Preference order, not a filter. `locale` is the best answer, `fallbackLocale` the next best,
  // and any other row this parent has is still better than what main held before it was localized —
  // that content is the only copy of every edit made while the entity was localized.
  //
  // Restricting to the named locales strands a parent that has neither, and the case where that
  // bites hardest is the one where the names are weakest: removing the `localization` block
  // outright leaves no configured default at all, so the only candidate is the locale recorded when
  // localization was first switched on. An entry authored solely under a default adopted since then
  // has no row there, keeps whatever main held beforehand, and is marked restored anyway.
  const preferred = [
    args.locale,
    ...(args.fallbackLocale && args.fallbackLocale !== args.locale
      ? [args.fallbackLocale]
      : []),
  ];

  // ONE row per parent, chosen by rank rather than per column.
  //
  // Ranking is what makes the choice shared. Asking each column for its own first non-null value
  // across the candidates looks equivalent and is not: a parent that has rows in several, with one
  // column left untranslated in the preferred row, takes that column from another language while
  // its neighbours and its publishing status come from the preferred one. The result is a
  // mixed-language document written to the table that is authoritative from then on, with the
  // record marking the restore terminally finished.
  //
  // Expressed as an ordering rather than a CASE so every bound locale appears in a comparison
  // against `_locale`, where all three dialects can infer its type. `_locale` breaks the tie among
  // the rest, so the row picked is the same one on every dialect and on a re-run.
  const parentRow = eq(
    shape.companion._parent as never,
    shape.main.id as never
  );
  const byPreference = preferred
    .map(locale => sql`(${shape.companion._locale} = ${locale}) desc`)
    .reduce((first, next) => sql`${first}, ${next}`);
  const ordering = sql`${byPreference}, ${shape.companion._locale} asc`;
  const fromChosenRow = (companionColumn: unknown) =>
    sql`(select ${companionColumn} from ${shape.companionTable} where ${parentRow} order by ${ordering} limit 1)`;

  const values: Record<string, unknown> = {};
  for (const pair of shape.pairs) {
    values[pair.field] = fromChosenRow(shape.companion[pair.column]);
  }
  if (args.status === true) {
    values.status = fromChosenRow(shape.companion._status);
  }

  // Guarded on the parent having any companion row at all. Without it a parent with none — one
  // created after localization was switched off, say — would be assigned SQL NULL, blanking the
  // main column instead of leaving it alone. There is nothing to restore for such a row.
  const hasRow = sql`exists (select 1 from ${shape.companionTable} where ${parentRow})`;
  const meta = metaTableFor(adapter.dialect);
  await adapter
    .getDrizzle<UpdatableDb>()
    .update(shape.mainTable)
    .set(values)
    .where(
      args.guard
        ? and(
            hasRow,
            sql`exists (select 1 from ${meta} where ${eq(meta.key, args.guard.key)} and ${eq(meta.value as never, args.guard.value as never)})`
          )
        : hasRow
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
 * `guard` is the claim this refresh runs under, carried INTO the statement rather than checked
 * before it. This is the one copy here whose damage outlives losing a race: it overwrites the
 * companion's default-locale rows from main, so a run that was displaced mid-flight would destroy
 * translations the run that displaced it has already seeded and published. Checking ownership
 * first cannot close that — the check and the statement are separate round trips — but a `WHERE`
 * the database evaluates alongside the update can, because a claim that has moved on makes it
 * match no rows.
 *
 * `refreshStatus` carries the main row's `status` across too. Publishing state moves while
 * localization is off, and the surviving companion row keeps whatever status it held when it was
 * last the authority. Defaulted, because the companion's `_status` is NOT NULL while main's
 * `status` need not be.
 */
/**
 * Set one locale's `_updated_at` to NULL, tolerating a companion that has no such column.
 *
 * Raw SQL because the column is deliberately not declared on the companion's Drizzle table — see
 * `readCompanionStamps` for why — so `.set()` cannot name it.
 *
 * A companion that predates the column is not an error here: it simply has no stamp to clear, and
 * every locale on it already reads as UNKNOWN. Anything else rethrows, so a permission fault is
 * not quietly absorbed into "there was nothing to do".
 *
 * The guard is part of the statement rather than a check before it. This clears the stamp on
 * EVERY row of the locale, and the caller passes the SOURCE locale — one half of every comparison
 * in the collection — so a superseded worker running it unguarded erases the whole collection's
 * chronology rather than one row's.
 */
async function clearLocaleStamp(
  adapter: CompanionIntrospectAdapter,
  args: {
    companionTableName: string;
    locale: string;
    guard?: { key: string; value: string };
  }
): Promise<void> {
  const stamp = buildCompanionStampTable(
    args.companionTableName,
    adapter.dialect
  );
  const meta = metaTableFor(adapter.dialect);
  const thisLocale = eq(stamp.locale as never, args.locale);

  try {
    await adapter
      .getDrizzle<UpdatableDb>()
      .update(stamp.table)
      .set({ [COMPANION_UPDATED_AT_COLUMN]: null })
      .where(
        args.guard
          ? and(
              thisLocale,
              sql`exists (select 1 from ${meta} where ${eq(meta.key, args.guard.key)} and ${eq(meta.value as never, args.guard.value as never)})`
            )
          : thisLocale
      );
  } catch (error) {
    if (isMissingColumnError(error, COMPANION_UPDATED_AT_COLUMN)) return;
    throw error;
  }
}

export async function refreshDefaultLocaleFromMain(
  adapter: CompanionIntrospectAdapter,
  args: CopyArgs & {
    refreshStatus?: boolean;
    guard?: { key: string; value: string };
  }
): Promise<void> {
  const resolved = await resolveCopyShape(args);
  if (!resolved) return;
  if (resolved.pairs.length === 0 && !args.refreshStatus) return;

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

  // 🔴 Clear this locale's `_updated_at` BEFORE replacing its content (i18n B2).
  //
  // This is a companion CONTENT write that does not go through `upsertCompanionRow`: it copies the
  // source locale's columns from the now-authoritative main table when localization is re-enabled
  // over a companion that survived a disable. Leaving the stamp alone attaches the OLD chronology
  // to NEW content, so a target that really is stale compares newer than its source and is never
  // reported.
  //
  // NULL rather than a timestamp, because what is true here is that the chronology is unknown:
  // the content came from main, whose own `updated_at` would be the precise answer but is not
  // reliably present on every entity kind this helper serves. Unknown under-reports, which is the
  // direction this feature fails in everywhere else.
  //
  // Ordered FIRST on purpose. If the clear lands and the copy does not, the row keeps its old
  // content with an unknown stamp — safe. The other order leaves new content wearing an old
  // stamp, which is the defect itself.
  //
  // 🔴 CARRIES THE SAME CLAIM GUARD as the copy, and inside the same statement rather than as a
  // pre-check, which would reopen the race the guard exists to close. This statement is NOT the
  // harmless one it looks like: it clears the stamp on EVERY row of the locale, and the locale it
  // is called for is the SOURCE — one half of every comparison in the collection. A superseded
  // worker running it unguarded therefore erases the whole collection's chronology and hides
  // every stale translation in it until each source row is rewritten, which is a far larger
  // effect than the one row it appears to touch.
  await clearLocaleStamp(adapter, {
    companionTableName: args.companionTableName,
    locale: args.locale,
    guard: args.guard,
  });

  const meta = metaTableFor(adapter.dialect);
  const thisLocale = eq(resolved.companion._locale as never, args.locale);
  await adapter
    .getDrizzle<UpdatableDb>()
    .update(resolved.companionTable)
    .set(values)
    .where(
      args.guard
        ? and(
            thisLocale,
            sql`exists (select 1 from ${meta} where ${eq(meta.key, args.guard.key)} and ${eq(meta.value as never, args.guard.value as never)})`
          )
        : thisLocale
    );
}
