/**
 * A translated field marked unique is unique within each language: a unique index on its
 * companion table over its value and `_locale`, so the same value is refused twice in one
 * language and allowed in two.
 *
 * A text column is keyed on `NULLIF(column, '')` rather than the column: a value left blank is
 * stored as `''`, and two blanks are not the same value. Inside the index a blank becomes NULL, and
 * NULLs never collide, so untranslated documents are never duplicates of one another, while what is
 * stored, and what every read returns, stays exactly as it was. PostgreSQL and SQLite key an index
 * on an expression; MySQL does from 8.0.13 (a functional key part, in its own parentheses), on a
 * SHA-256 since it cannot key an expression returning TEXT. Any other column (a number, a
 * boolean, a date) has no blank, so it is keyed as it is: zero and false are values like any other.
 *
 * @module domains/i18n/migration/companion-unique-indexes
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { builderColumnIsUnique } from "../../dynamic-collections/services/dynamic-collection-schema-service";
import type { ColumnOrigin } from "../../schema/services/field-column-descriptor";
import { indexNameForColumns } from "../../schema/services/index-name";
import { isFieldLocalized } from "../classify-fields";

import { q } from "./ddl-types";
import { fieldToLocalizedColumnSpec } from "./field-to-column-spec";
import type { CompanionFieldLike } from "./reconcile-companion";
import type { LocalizedColumnKind } from "./types";

/**
 * A field as the companion knows it, with what makes its column unique: the flag, or the
 * cardinality a one-to-one relationship carries instead of one.
 */
export type UniqueFieldLike = CompanionFieldLike & {
  unique?: boolean;
  /** As loose as every caller's own field shape: the predicate below reads it, nobody else. */
  options?: unknown;
};

/**
 * Whether a field's column is unique, judged by the one predicate the shared columns use. A
 * one-to-one relationship is unique by its cardinality and carries no `unique` flag, so reading
 * the flag alone let two rows in one language point at the same target.
 */
export function isUniqueField(field: UniqueFieldLike): boolean {
  return builderColumnIsUnique(field as unknown as FieldDefinition);
}

/** A translated field that is unique within each language, and its companion column. */
export interface UniqueTranslatedColumn {
  field: string;
  column: string;
  /** Whether the column stores text, which alone has a blank (`''`) to leave out. */
  text: boolean;
  /**
   * What the column stores, where it is known: what decides whether a dialect can key it at all.
   * Unknown for a column recorded by name alone, by a snapshot written before kinds were kept.
   */
  kind?: LocalizedColumnKind;
}

/** The storage kinds that hold text. */
const TEXT_KINDS: ReadonlySet<LocalizedColumnKind> = new Set([
  "text",
  "longText",
  "shortText",
]);

/** Whether a companion column of `kind` stores text. */
export function isTextKind(kind: LocalizedColumnKind): boolean {
  return TEXT_KINDS.has(kind);
}

/** The translated fields marked unique, with the companion column each one has. */
export function uniqueTranslatedColumns(args: {
  fields: readonly UniqueFieldLike[];
  entityLocalized: boolean;
  dialect: SupportedDialect;
  builtBy: ColumnOrigin;
}): UniqueTranslatedColumn[] {
  return args.fields.flatMap(field => {
    if (!isUniqueField(field)) return [];
    if (!isFieldLocalized(field, args.entityLocalized)) return [];
    const spec = fieldToLocalizedColumnSpec(field, args.dialect, args.builtBy);
    return spec
      ? [
          {
            field: field.name,
            column: spec.name,
            text: isTextKind(spec.kind),
            kind: spec.kind,
          },
        ]
      : [];
  });
}

/**
 * Unique columns recorded by name (a snapshot, a migration file's header), with what each stores.
 *
 * An entry's own kind is taken first: a column the change removes or renames is no longer in the
 * companion's columns, and a way back that recreates its index has only what was recorded with it.
 * Read off the columns otherwise, and, for a record written before kinds were kept, taken as text,
 * so recreating a text column's index still leaves a blank out.
 */
export function uniqueColumnsWithKind(
  entries: readonly {
    field: string;
    column: string;
    kind?: LocalizedColumnKind;
  }[],
  columns: readonly { name: string; kind: LocalizedColumnKind }[]
): UniqueTranslatedColumn[] {
  const kindOf = new Map(columns.map(c => [c.name, c.kind]));
  return entries.map(({ field, column, kind: recorded }) => {
    const kind = recorded ?? kindOf.get(column);
    return {
      field,
      column,
      text: kind === undefined || isTextKind(kind),
      ...(kind === undefined ? {} : { kind }),
    };
  });
}

/**
 * The companion column of every translated field in `fields`, unique or not: the columns whose
 * per-language index a change may have to drop.
 */
export function translatedColumnNames(args: {
  fields: readonly UniqueFieldLike[];
  entityLocalized: boolean;
  dialect: SupportedDialect;
  builtBy: ColumnOrigin;
}): string[] {
  return args.fields.flatMap(field => {
    if (!isFieldLocalized(field, args.entityLocalized)) return [];
    const spec = fieldToLocalizedColumnSpec(field, args.dialect, args.builtBy);
    return spec ? [spec.name] : [];
  });
}

/** The name of a column's per-language unique index on a companion table. */
export function companionUniqueIndexName(
  companionTable: string,
  column: string
): string {
  return indexNameForColumns(companionTable, [column, "_locale"], true);
}

/** What a companion's per-language unique indexes are brought to `wanted` by. */
interface CompanionUniqueIndexArgs {
  dialect: SupportedDialect;
  companionTable: string;
  wanted: readonly UniqueTranslatedColumn[];
  /** Every translated column the companion has, so only this module's own indexes are dropped. */
  translatedColumns: readonly string[];
  liveIndexNames: ReadonlySet<string>;
  /**
   * Those of `liveIndexNames` the database holds as an index that is not unique. A name proves
   * nothing about what an index enforces: one left under a wanted index's name that is not unique
   * (drift, a hand-written migration) holds nothing, so it is dropped and the real one created.
   * Left out where the indexes were not read, as for a migration file.
   */
  liveNotUnique?: ReadonlySet<string>;
}

/**
 * The statements that bring a companion's per-language unique indexes to `wanted`, drops first
 * (`companionUniqueIndexChanges`). For a caller that changes no column alongside them.
 */
export function companionUniqueIndexStatements(
  args: CompanionUniqueIndexArgs
): string[] {
  const { drops, creates } = companionUniqueIndexChanges(args);
  return [...drops, ...creates];
}

/**
 * What the index keys a column on. Text leaves its blank out (`NULLIF`); any other column is keyed
 * as it is.
 *
 * MySQL takes an expression only as a functional key part, in parentheses of its own, and cannot
 * key one that returns TEXT, which a companion's text column is. It keys a SHA-256 instead, of the
 * value's collation weight (`WEIGHT_STRING`) rather than its bytes: two values the column's
 * collation calls equal ("About" and "about" under a case-insensitive one) weigh the same, so the
 * index judges "the same value" exactly as a shared unique column of that collation does, at any
 * length, a blank still NULL.
 */
function indexKey(
  column: UniqueTranslatedColumn,
  dialect: SupportedDialect
): string {
  const quoted = q(column.column, dialect);
  if (!column.text) return quoted;
  const value = `NULLIF(${quoted}, '')`;
  return dialect === "mysql" ? `(SHA2(WEIGHT_STRING(${value}), 256))` : value;
}

/**
 * The index of each translated column no longer wanted, dropped, and each missing one wanted,
 * created. Asked against the indexes the table has (`liveIndexNames`), so a statement is never
 * written for an index already there or already gone, which MySQL, having no `IF EXISTS` on
 * either, would refuse.
 *
 * Apart, because a change that also alters columns has to place them: the drops before any column
 * goes, since SQLite will not drop a column an index uses and MySQL will not drop one a functional
 * key part uses, and the creates after every column is in place.
 */
export function companionUniqueIndexChanges(args: CompanionUniqueIndexArgs): {
  drops: string[];
  creates: string[];
} {
  const { dialect, companionTable, liveIndexNames } = args;
  const notUnique = args.liveNotUnique ?? new Set<string>();
  const table = q(companionTable, dialect);
  const wanted = new Set(args.wanted.map(w => w.column));
  const nameOf = (column: string) =>
    companionUniqueIndexName(companionTable, column);
  // A wanted index held under its name but not unique is replaced: dropped with the drops, which
  // run first, and created with the creates.
  const replaced = args.wanted
    .map(w => nameOf(w.column))
    .filter(name => liveIndexNames.has(name) && notUnique.has(name));
  const creates = args.wanted
    .filter(w => {
      const name = nameOf(w.column);
      return !liveIndexNames.has(name) || notUnique.has(name);
    })
    .map(w => {
      const name = q(
        companionUniqueIndexName(companionTable, w.column),
        dialect
      );
      const key = indexKey(w, dialect);
      const ifNotExists = dialect === "mysql" ? "" : "IF NOT EXISTS ";
      return `CREATE UNIQUE INDEX ${ifNotExists}${name} ON ${table} (${key}, ${q("_locale", dialect)})`;
    });
  // Each column once: a caller may list a column the change keeps under both its old and new
  // fields, and MySQL refuses a second DROP of the same index.
  const drops = [
    ...[...new Set(args.translatedColumns)]
      .filter(column => !wanted.has(column))
      .map(nameOf)
      .filter(name => liveIndexNames.has(name)),
    ...replaced,
  ].map(name =>
    dialect === "mysql"
      ? `DROP INDEX ${q(name, dialect)} ON ${table}`
      : `DROP INDEX IF EXISTS ${q(name, dialect)}`
  );
  return { drops, creates };
}
