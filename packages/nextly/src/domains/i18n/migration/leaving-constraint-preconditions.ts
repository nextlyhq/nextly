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
  const { adapter, dialect } = args;
  const main = q(args.tableName, dialect);
  const companion = q(`${args.tableName}_locales`, dialect);
  const locale = lit(args.defaultLocale);
  const language = languageName(args.defaultLocale);
  const before = new Map(args.oldFields.map(f => [f.name, f]));

  /** How many entries have no default-language value in `col`. */
  const missing = async (col: string) => {
    const [row] = await adapter.executeQuery<{ n: number | string }>(
      `SELECT COUNT(*) AS n FROM ${main} m LEFT JOIN ${companion} c ` +
        `ON c.${q("_parent", dialect)} = m.${q("id", dialect)} AND c.${q("_locale", dialect)} = ${locale} ` +
        `WHERE c.${col} IS NULL`
    );
    return Number(row?.n ?? 0);
  };
  /**
   * How many entries would share a value with another entry: every entry of every value held more
   * than once, summed over those values, so two pairs count four. The values are never read.
   */
  const sharing = async (col: string) => {
    const shared = restoredValue(
      {
        dialect,
        mainTable: args.tableName,
        companionTable: `${args.tableName}_locales`,
        defaultLocale: args.defaultLocale,
      },
      `${companion}.${col}`
    );
    const [row] = await adapter.executeQuery<{ n: number | string }>(
      `SELECT COALESCE(SUM(g.n), 0) AS n FROM (SELECT COUNT(*) AS n FROM (SELECT ${shared} AS v FROM ${main}) s ` +
        `WHERE s.v IS NOT NULL GROUP BY s.v HAVING COUNT(*) > 1) g`
    );
    return Number(row?.n ?? 0);
  };

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

function requiredRefusal(
  name: string,
  count: number,
  language: string,
  surface: TranslationSurface
): LeavingTranslationRefusal {
  const which = count === 1 ? "that entry" : "those entries";
  return refusal(
    `fields.${name}`,
    "REQUIRED_FIELD_LEAVES_WITHOUT_VALUES",
    `${entries(count)} ${count === 1 ? "has" : "have"} no ${language} ${name}, and its ${language} value becomes the shared one.`,
    [
      surface === "builder"
        ? `Give ${which} ${withArticle(language)} ${name}, or turn off Required, and save again.`
        : `Give ${which} ${withArticle(language)} ${name}, or remove \`required\`, and run \`nextly migrate:create\` again.`,
    ]
  );
}

function uniqueRefusal(
  name: string,
  count: number,
  language: string,
  surface: TranslationSurface
): LeavingTranslationRefusal {
  return refusal(
    `fields.${name}`,
    "UNIQUE_FIELD_LEAVES_OVER_DUPLICATES",
    `${entries(count)} would share a value for ${name}, which must be unique once it is shared. ` +
      `Each entry keeps its ${language} value, or another language's when it has no ${language} one.`,
    [
      surface === "builder"
        ? "Give them their own values, or turn off Unique, and save again."
        : "Give them their own values, or remove `unique`, and run `nextly migrate:create` again.",
    ]
  );
}
