/**
 * What a Required or Unique field's default-language values must satisfy before the field stops
 * being translated, asked before the change alters anything.
 *
 * Each entry's default-language value becomes its shared one. A Required field needs one for every
 * entry, and a Unique field needs no two entries to hold the same one. Both are read from the
 * companion as it is now. A field whose values cannot take the setting is refused, naming the field
 * and how many entries are in the way, never a value: a stored value can be hidden from someone
 * who may still edit the schema, and refusals reach the log.
 *
 * @module domains/i18n/migration/leaving-constraint-preconditions
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../../errors/nextly-error";
import type { ColumnOrigin } from "../../schema/services/field-column-descriptor";

import { lit, q } from "./ddl-types";
import {
  type LeavingFieldLike,
  type LeavingTranslationRefusal,
  leavingFieldConstraints,
  refusal,
  type TranslationSurface,
} from "./field-leaves-translation-rules";
import { fieldToLocalizedColumnSpec } from "./field-to-column-spec";
import { restoredValue } from "./generate-down";
import type { CompanionMigrationSpec } from "./types";

interface PreconditionAdapter {
  executeQuery<T = unknown>(sql: string): Promise<T[]>;
}

/**
 * A language's English name ("English" for `en`), for a message about its values. The code itself
 * when the runtime cannot name it.
 */
function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    // `Intl.DisplayNames` refuses a code it cannot parse; the code is still the language's name.
    return code;
  }
}

/**
 * Where a leaving field's values are counted: the main table's entries, and the companion holding
 * each one's languages.
 */
interface LeavingValuesSource {
  adapter: PreconditionAdapter;
  dialect: SupportedDialect;
  mainTable: string;
  companionTable: string;
  defaultLocale: string;
}

/**
 * A clause true for an entry of the main table (`main`, quoted) with no companion row at all. The
 * copy into a shared column leaves such an entry's main value as it is.
 */
function hasNoCompanionRow(source: LeavingValuesSource, main: string): string {
  const { dialect } = source;
  const comp = q(source.companionTable, dialect);
  return `NOT EXISTS (SELECT 1 FROM ${comp} WHERE ${comp}.${q("_parent", dialect)} = ${main}.${q("id", dialect)})`;
}

/**
 * How many entries have no default-language value in the companion column `col` (quoted): no
 * companion row in that language, or NULL there. With `mainCol` (quoted), the main table's column
 * the move copies into, which already exists when the shared file runs: an entry with no companion
 * row at all keeps its main value, so it counts only where that is NULL too.
 */
async function entriesWithoutDefaultValue(
  source: LeavingValuesSource,
  col: string,
  mainCol?: string
): Promise<number> {
  const { adapter, dialect } = source;
  const keptOnMain =
    mainCol === undefined
      ? ""
      : ` AND NOT (${hasNoCompanionRow(source, "m")} AND m.${mainCol} IS NOT NULL)`;
  const [row] = await adapter.executeQuery<{ n: number | string }>(
    `SELECT COUNT(*) AS n FROM ${q(source.mainTable, dialect)} m LEFT JOIN ${q(source.companionTable, dialect)} c ` +
      `ON c.${q("_parent", dialect)} = m.${q("id", dialect)} AND c.${q("_locale", dialect)} = ${lit(source.defaultLocale)} ` +
      `WHERE c.${col} IS NULL${keptOnMain}`
  );
  return Number(row?.n ?? 0);
}

/**
 * How many entries would share a value in the companion column `col` (quoted) with another entry,
 * judged on the value the move writes (`restoredValue`): every entry of every value held more than
 * once, summed over those values, so two pairs count four. The values are never read. With
 * `mainCol` (quoted, as above), an entry with no companion row is judged on its main value.
 */
async function entriesSharingAValue(
  source: LeavingValuesSource,
  col: string,
  mainCol?: string
): Promise<number> {
  const { adapter, dialect } = source;
  const main = q(source.mainTable, dialect);
  const restored = restoredValue(
    source,
    `${q(source.companionTable, dialect)}.${col}`
  );
  const shared =
    mainCol === undefined
      ? restored
      : `CASE WHEN ${hasNoCompanionRow(source, main)} THEN ${main}.${mainCol} ELSE ${restored} END`;
  const [row] = await adapter.executeQuery<{ n: number | string }>(
    `SELECT COALESCE(SUM(g.n), 0) AS n FROM (SELECT COUNT(*) AS n FROM (SELECT ${shared} AS v FROM ${q(source.mainTable, dialect)}) s ` +
      `WHERE s.v IS NOT NULL GROUP BY s.v HAVING COUNT(*) > 1) g`
  );
  return Number(row?.n ?? 0);
}

function entries(count: number): string {
  return count === 1 ? "1 entry" : `${count} entries`;
}

function withArticle(word: string): string {
  return /^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`;
}

/**
 * The refusals for the fields in `leaving` that are Required or Unique after the change, one per
 * setting the default language's values cannot take. Empty when every such field can become shared
 * with its setting in place.
 *
 * - Required: an entry with no default-language value, either no companion row in that language or
 *   NULL there, would be left without one.
 * - Unique: two entries would share one value. Judged on the values the move writes
 *   (`restoredValue`): an entry's default-language value, or, for an entry with no row in that
 *   language, its first language's by code. Compared as the database's unique index will compare
 *   them, so MySQL's case-insensitive collation counts "Code" and "code" as one value, as its
 *   index does.
 */
export async function refusalsForConstrainedFieldsLeaving(args: {
  adapter: PreconditionAdapter;
  dialect: SupportedDialect;
  /** The main table; the companion is `<tableName>_locales`. */
  tableName: string;
  builtBy: ColumnOrigin;
  defaultLocale: string;
  leaving: ReadonlySet<string>;
  oldFields: readonly LeavingFieldLike[];
  newFields: readonly LeavingFieldLike[];
  /** Fields a unique index covers, beside their own `unique` flag. */
  uniqueIndexed?: ReadonlySet<string>;
  /**
   * A field renamed in this change, as companion columns (new name to old): `oldFields` already
   * carries it under its new name, while its values are still in the column it had.
   */
  renamedFrom?: ReadonlyMap<string, string>;
  surface: TranslationSurface;
}): Promise<LeavingTranslationRefusal[]> {
  const { dialect } = args;
  const language = languageName(args.defaultLocale);
  const before = new Map(args.oldFields.map(f => [f.name, f]));
  const source: LeavingValuesSource = {
    adapter: args.adapter,
    dialect,
    mainTable: args.tableName,
    companionTable: `${args.tableName}_locales`,
    defaultLocale: args.defaultLocale,
  };
  const missing = (col: string) => entriesWithoutDefaultValue(source, col);
  const sharing = (col: string) => entriesSharingAValue(source, col);

  const refusals: LeavingTranslationRefusal[] = [];
  for (const field of args.newFields) {
    const col = leavingValuesColumn(field, {
      ...args,
      dialect,
      before,
    });
    if (col === undefined) continue;
    refusals.push(
      ...(await refusalsForOneField(field, col, {
        uniqueIndexed: args.uniqueIndexed,
        language,
        surface: args.surface,
        missing,
        sharing,
      }))
    );
  }
  return refusals;
}

/**
 * The quoted companion column a leaving field's values are in RIGHT NOW, or undefined for a field
 * that is not leaving translation or stores no column. A field this change renames is already
 * under its new name in `before`, while its values are still in the column it had.
 */
function leavingValuesColumn(
  field: LeavingFieldLike,
  ctx: {
    dialect: SupportedDialect;
    builtBy: ColumnOrigin;
    leaving: ReadonlySet<string>;
    before: ReadonlyMap<string, LeavingFieldLike>;
    renamedFrom?: ReadonlyMap<string, string>;
  }
): string | undefined {
  if (!ctx.leaving.has(field.name)) return undefined;
  const previous = ctx.before.get(field.name);
  if (previous === undefined) return undefined;
  const column = fieldToLocalizedColumnSpec(
    previous,
    ctx.dialect,
    ctx.builtBy
  )?.name;
  if (column === undefined) return undefined;
  return q(ctx.renamedFrom?.get(column) ?? column, ctx.dialect);
}

/** One leaving field's refusals: one per setting the default language's values cannot take. */
async function refusalsForOneField(
  field: LeavingFieldLike,
  col: string,
  ctx: {
    uniqueIndexed?: ReadonlySet<string>;
    language: string;
    surface: TranslationSurface;
    missing: (col: string) => Promise<number>;
    sharing: (col: string) => Promise<number>;
  }
): Promise<LeavingTranslationRefusal[]> {
  const constraints = leavingFieldConstraints(field, ctx.uniqueIndexed);
  const refusals: LeavingTranslationRefusal[] = [];
  if (constraints.includes("required")) {
    const without = await ctx.missing(col);
    if (without > 0)
      refusals.push(
        requiredRefusal(field.name, without, ctx.language, ctx.surface)
      );
  }
  if (constraints.includes("unique")) {
    const shared = await ctx.sharing(col);
    if (shared > 0)
      refusals.push(
        uniqueRefusal(field.name, shared, ctx.language, ctx.surface)
      );
  }
  return refusals;
}

/**
 * Whose steps a refusal here names: the Schema Builder's, the config's before `migrate:create`
 * writes the files, or `nextly migrate`'s once they are written and only the data can change.
 */
type PreconditionSurface = TranslationSurface | "migrate";

/**
 * The step `nextly migrate`'s refusal adds: the check reads the values once, before the move's
 * first file, so a write that lands while the move runs is not seen.
 */
const STOP_WRITES_STEP =
  "Stop the app's writes while `nextly migrate` runs: the values are checked once, before the move starts.";

function requiredRefusal(
  name: string,
  count: number,
  language: string,
  surface: PreconditionSurface
): LeavingTranslationRefusal {
  const which = count === 1 ? "that entry" : "those entries";
  const give = `Give ${which} ${withArticle(language)} ${name}`;
  return refusal(
    `fields.${name}`,
    "REQUIRED_FIELD_LEAVES_WITHOUT_VALUES",
    `${entries(count)} ${count === 1 ? "has" : "have"} no ${language} ${name}, and its ${language} value becomes the shared one.`,
    [
      surface === "builder"
        ? `${give}, or turn off Required, and save again.`
        : surface === "migrate"
          ? `${give}, then run \`nextly migrate\` again.`
          : `${give}, or remove \`required\`, and run \`nextly migrate:create\` again.`,
      ...(surface === "migrate" ? [STOP_WRITES_STEP] : []),
    ]
  );
}

function uniqueRefusal(
  name: string,
  count: number,
  language: string,
  surface: PreconditionSurface
): LeavingTranslationRefusal {
  return refusal(
    `fields.${name}`,
    "UNIQUE_FIELD_LEAVES_OVER_DUPLICATES",
    `${entries(count)} would share a value for ${name}, which must be unique once it is shared. ` +
      `Each entry keeps its ${language} value, or another language's when it has no ${language} one.`,
    [
      surface === "builder"
        ? "Give them their own values, or turn off Unique, and save again."
        : surface === "migrate"
          ? "Give them their own values, then run `nextly migrate` again."
          : "Give them their own values, or remove `unique`, and run `nextly migrate:create` again.",
      ...(surface === "migrate" ? [STOP_WRITES_STEP] : []),
    ]
  );
}

/**
 * Refuses an `archive` or `shared` migration file, before any of its statements runs, where the
 * default language's values cannot take the settings its header records (`spec.settings`): an
 * entry with none for a Required field, or two entries sharing one for a field a unique index
 * covers. Checked at the `archive` file, before the move's first statement, and again at the
 * `shared` file, for a run that stopped between them. The same counts the Schema Builder and
 * `migrate:create` give, naming the field and how many entries, never a value. Nothing is changed
 * or recorded: once the data is fixed, a plain `nextly migrate` runs the move.
 *
 * @throws NextlyError `CONFLICT` whose message carries each refusal's code and sentence
 */
export async function refuseLeavingFileThatCannotTakeItsSettings(
  adapter: PreconditionAdapter,
  spec: Pick<
    CompanionMigrationSpec,
    | "dialect"
    | "collection"
    | "mainTable"
    | "companionTable"
    | "defaultLocale"
    | "settings"
  >,
  source: string,
  /**
   * Whether the main table already has the leaving fields' columns, as when the shared file runs
   * after the main file: an entry with no companion row then keeps its main value through the copy.
   */
  mainHasColumns = false
): Promise<void> {
  if (spec.settings === undefined) return;
  const values: LeavingValuesSource = {
    adapter,
    dialect: spec.dialect,
    mainTable: spec.mainTable,
    companionTable: spec.companionTable,
    defaultLocale: spec.defaultLocale,
  };
  const language = languageName(spec.defaultLocale);
  const col = (column: string) => q(column, spec.dialect);
  const refusals: LeavingTranslationRefusal[] = [];
  const onMain = (column: string) => (mainHasColumns ? col(column) : undefined);
  for (const { field, column } of spec.settings.required) {
    const without = await entriesWithoutDefaultValue(
      values,
      col(column),
      onMain(column)
    );
    if (without > 0)
      refusals.push(requiredRefusal(field, without, language, "migrate"));
  }
  for (const { field, column } of spec.settings.unique) {
    const shared = await entriesSharingAValue(
      values,
      col(column),
      onMain(column)
    );
    if (shared > 0)
      refusals.push(uniqueRefusal(field, shared, language, "migrate"));
  }
  if (refusals.length === 0) return;
  throw NextlyError.conflict({
    reason: "state",
    message: refusals.map(r => `${r.code}: ${r.message}`).join(" "),
    logContext: {
      source,
      entity: spec.collection,
      fields: refusals.map(r => r.path),
    },
  });
}
