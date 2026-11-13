/**
 * `nextly migrate` making each one-to-one relationship's column unique where an earlier release
 * left it without its uniqueness, after checking it for repeated values.
 *
 * A one-to-one is unique by the one rule every road asks (`builderColumnIsUnique`), and the
 * desired schema declares its `uq_` index. A column an earlier release created without it (a
 * one-to-one added to an existing collection, which never got one) keeps taking repeats until
 * something adds it, so the run adds it, once its files have run: the definitions they leave are
 * the ones judged. Every column is checked first, and any repeat refuses the whole step before
 * an index is created, naming each value (`uniqueColumnRepeatsError`).
 *
 * A translated one-to-one is unique within each language, by its index on the translations table
 * (`companionUniqueIndexName`), and its values are checked within each language.
 *
 * Each column is judged from the live database on every run: one already unique is left alone,
 * so a run stopped part-way leaves the next one adding only what is missing, and nothing twice.
 * The index is the one the desired schema declares (`uniqueIndexNameForColumn`), so a migration
 * file written later for the same uniqueness finds it already there.
 *
 * @module domains/schema/migrate/one-to-one-uniques
 */

import type { SupportedDialect } from "../../../database/schema-registry";
import { NextlyError } from "../../../errors/nextly-error";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { builderColumnIsUnique } from "../../dynamic-collections/services/dynamic-collection-schema-service";
import { resolveLocalizedFieldNames } from "../../i18n/classify-fields";
import {
  companionUniqueIndexName,
  companionUniqueIndexStatements,
  uniqueTranslatedColumns,
} from "../../i18n/migration/companion-unique-indexes";
import {
  introspectLiveColumns,
  introspectTableNames,
  introspectUnusableIndexes,
} from "../pipeline/diff/introspect-live";
import {
  readIndexUniqueness,
  readNameHoldersElsewhere,
  readUniqueColumns,
  uniqueIndexNames,
} from "../pipeline/live-table-facts";
import { createIndexSql } from "../pipeline/sql-templates/create-index";
import type { RequiredColumnEntity } from "../required-column-refusal";
import { fieldsByColumnOf } from "../required-column-registries";
import {
  uniqueIndexNameForColumn,
  uniquenessCanBeAnIndex,
} from "../services/index-name";

import {
  readRepeatedValues,
  registeredEntities,
  uniqueColumnRepeatsError,
  type RegisteredEntity,
  type UniqueColumnRepeats,
} from "./unique-column-guard";

/** What the step names itself as, in its refusal and its report. */
const ONE_TO_ONE_UNIQUES_STEP = "Making one-to-one relationships unique";

/** A one-to-one's column that holds no uniqueness yet, and the statements that give it. */
interface MissingUniqueness {
  entity: RequiredColumnEntity;
  field: string;
  table: string;
  column: string;
  /** A translations table's language column: the uniqueness holds within each language. */
  language?: string;
  /** A translated text column, whose index leaves a blank out, so blanks never repeat. */
  blankRepeatsNothing?: boolean;
  /** The index the statements create, whose name nothing else may hold. */
  index: string;
  statements: string[];
}

/** What the step needs: the database, and how to run a statement on it and say what it did. */
export interface OneToOneUniquesDeps {
  db: unknown;
  dialect: SupportedDialect;
  executeQuery: (statement: string) => Promise<unknown>;
  logger: { info(message: string): void };
}

/** The one-to-one relationships among `fields`, translated or not. */
function oneToOnesOf(fields: readonly FieldDefinition[]): FieldDefinition[] {
  return fields.filter(
    field => field.type === "relationship" && builderColumnIsUnique(field)
  );
}

const quoted = (dialect: SupportedDialect) => (name: string) =>
  dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

/**
 * An entity's untranslated one-to-ones whose main-table column is there and holds no uniqueness,
 * and could hold it as an index: as the desired schema asks, a column the dialect cannot key gets
 * none.
 */
async function missingOnMainTable(
  db: unknown,
  dialect: SupportedDialect,
  { entity, table, fields, localized }: RegisteredEntity
): Promise<MissingUniqueness[]> {
  const translated = new Set(resolveLocalizedFieldNames(fields, localized));
  const oneToOnes = oneToOnesOf(fields).filter(f => !translated.has(f.name));
  if (oneToOnes.length === 0) return [];
  const columnOf = new Map(
    [...fieldsByColumnOf(oneToOnes, dialect, false)].map(([column, name]) => [
      name,
      column,
    ])
  );
  const live = new Map(
    (await introspectLiveColumns(db, dialect, [table])).tables[0]?.columns.map(
      c => [c.name.toLowerCase(), c]
    ) ?? []
  );
  const unique = new Set(
    [...(await readUniqueColumns(db, dialect, table)).keys()].map(c =>
      c.toLowerCase()
    )
  );
  // An index a failed or interrupted concurrent build left under the name holds nothing, and the
  // create's `IF NOT EXISTS` would leave it in place: it is dropped first.
  const unusable = await introspectUnusableIndexes(db, dialect, [table]);
  const missing: MissingUniqueness[] = [];
  for (const field of oneToOnes) {
    const column = columnOf.get(field.name);
    const present = column === undefined ? undefined : live.get(column);
    if (column === undefined || present === undefined || unique.has(column)) {
      continue;
    }
    if (!uniquenessCanBeAnIndex(present.type, dialect)) continue;
    const index = {
      name: uniqueIndexNameForColumn(table, column),
      columns: [column],
      unique: true,
    };
    missing.push({
      entity,
      field: field.name,
      table,
      column,
      index: index.name,
      statements: [
        ...(unusable.has(index.name.toLowerCase())
          ? [`DROP INDEX IF EXISTS ${quoted(dialect)(index.name)}`]
          : []),
        createIndexSql(table, index, dialect, quoted(dialect)),
      ],
    });
  }
  return missing;
}

/**
 * An entity's translated one-to-ones whose per-language unique index on its translations table
 * is not there: the index a translated one-to-one is unique by within each language.
 */
async function missingOnTranslations(
  db: unknown,
  dialect: SupportedDialect,
  { entity, table, fields, localized, builtBy }: RegisteredEntity
): Promise<MissingUniqueness[]> {
  const wanted = uniqueTranslatedColumns({
    fields: oneToOnesOf(fields),
    entityLocalized: localized,
    dialect,
    builtBy,
  });
  if (wanted.length === 0) return [];
  const companionTable = `${table}_locales`;
  const [present] = await introspectTableNames(db, dialect, [companionTable]);
  if (present === undefined) return [];
  const indexes = await readIndexUniqueness(db, dialect, present);
  // An index a failed or interrupted concurrent build left under the name holds nothing: it counts
  // as not unique, so the statements below replace it.
  const unusable = await introspectUnusableIndexes(db, dialect, [present]);
  const unique = new Set(
    [...uniqueIndexNames(indexes)].filter(
      name => !unusable.has(name.toLowerCase())
    )
  );
  // A column the translations table does not have yet holds nothing to repeat, and gets its index
  // when the run adds it: judged here, its absent values would stop the run. One the dialect
  // cannot key as it is (MySQL's JSON, as a reference to one of several collections is) gets no
  // index, as the desired schema gives it none.
  const columnTypes = new Map(
    (
      await introspectLiveColumns(db, dialect, [present])
    ).tables[0]?.columns.map(column => [
      column.name.toLowerCase(),
      column.type,
    ]) ?? []
  );
  return wanted
    .filter(c => {
      const type = columnTypes.get(c.column.toLowerCase());
      return (
        type !== undefined &&
        uniquenessCanBeAnIndex(type, dialect) &&
        !unique.has(companionUniqueIndexName(companionTable, c.column))
      );
    })
    .map(c => ({
      entity,
      field: c.field,
      table: present,
      column: c.column,
      language: "_locale",
      blankRepeatsNothing: c.text,
      index: companionUniqueIndexName(companionTable, c.column),
      statements: companionUniqueIndexStatements({
        dialect,
        companionTable,
        wanted: [c],
        translatedColumns: [c.column],
        liveIndexNames: new Set(indexes.keys()),
        liveNotUnique: new Set(
          [...indexes.keys()].filter(name => !unique.has(name))
        ),
      }),
    }));
}

/**
 * The one-to-ones of the registry's collections and Singles that hold no uniqueness yet: an
 * untranslated one on its main table, a translated one on its translations table, per language.
 */
async function missingUniqueness(
  db: unknown,
  dialect: SupportedDialect
): Promise<MissingUniqueness[]> {
  const missing: MissingUniqueness[] = [];
  for (const registered of await registeredEntities(db, dialect)) {
    // A plugin's tables follow its own migration modules, which would read an index made here as
    // drift; its one-to-ones are its modules' to make unique.
    if (registered.source.startsWith("plugin")) continue;
    missing.push(
      ...(await missingOnMainTable(db, dialect, registered)),
      ...(await missingOnTranslations(db, dialect, registered))
    );
  }
  return missing;
}

/**
 * Refuse, before any index is created, a uniqueness whose index name another object already
 * holds (`readNameHoldersElsewhere`), or another index on its own main table: PostgreSQL's and
 * SQLite's `IF NOT EXISTS` would skip the create, and the run would report a uniqueness nothing
 * enforces; MySQL would refuse the duplicate name part-way. An index there that the database
 * cannot use is not counted: the target's statements replace it. A translations table's index of
 * another kind under the name is replaced by its statements too.
 */
async function refuseNamesHeldElsewhere(
  db: unknown,
  dialect: SupportedDialect,
  missing: readonly MissingUniqueness[]
): Promise<void> {
  const held: string[] = [];
  for (const target of missing) {
    const holders = await readNameHoldersElsewhere(db, dialect, target.table, [
      target.index,
    ]);
    const holder = holders.get(target.index);
    if (holder !== undefined) {
      held.push(
        `${target.entity.slug}.${target.field} (its index ${target.index} is the name of the ${holder.type} ${holder.table === null ? holder.name : `on ${holder.table}`})`
      );
      continue;
    }
    if (target.language !== undefined) continue;
    const onTable = await readIndexUniqueness(db, dialect, target.table);
    const unusable = await introspectUnusableIndexes(db, dialect, [
      target.table,
    ]);
    if (
      onTable.has(target.index) &&
      !unusable.has(target.index.toLowerCase())
    ) {
      held.push(
        `${target.entity.slug}.${target.field} (its index ${target.index} is the name of another index on ${target.table})`
      );
    }
  }
  if (held.length === 0) return;
  throw uniqueIndexNameHeldError(held);
}

/** What the refusal of a uniqueness whose index name another object holds tells the reader to do. */
export const UNIQUE_INDEX_NAME_HELD_ADVICE =
  "Rename or drop what holds the name, then run `nextly migrate` again.";

/**
 * The refusal of uniquenesses whose index names other objects hold.
 *
 * @param held each one-to-one's field, its index name, and what holds that name
 */
export function uniqueIndexNameHeldError(held: readonly string[]): NextlyError {
  return NextlyError.conflict({
    reason: "state",
    message: `${ONE_TO_ONE_UNIQUES_STEP} was not applied: ${held.join("; ")}. ${UNIQUE_INDEX_NAME_HELD_ADVICE}`,
    logContext: { reason: "unique-index-name-held", held: [...held] },
  });
}

/**
 * Make every one-to-one's column unique that is not, once none of them repeats a value; refuse,
 * creating nothing, while any does.
 *
 * @returns how many columns were made unique
 * @throws {NextlyError} the repeats refusal, naming each column and its repeated values
 */
export async function makeOneToOnesUnique(
  deps: OneToOneUniquesDeps
): Promise<number> {
  const { db, dialect } = deps;
  const missing = await missingUniqueness(db, dialect);
  if (missing.length === 0) return 0;

  // Every column is checked before the first index is created, so a refusal changes nothing.
  const refused: UniqueColumnRepeats[] = [];
  for (const target of missing) {
    const repeats = await readRepeatedValues(
      db,
      dialect,
      target.table,
      target.column,
      target.language,
      target.blankRepeatsNothing
    );
    if (repeats.length > 0) {
      const { entity, field, table, column } = target;
      // A one-to-one's values are ids of entries, which the refusal shows.
      refused.push({ entity, field, table, column, repeats, showValues: true });
    }
  }
  if (refused.length > 0) {
    throw uniqueColumnRepeatsError(refused, ONE_TO_ONE_UNIQUES_STEP);
  }
  await refuseNamesHeldElsewhere(db, dialect, missing);

  for (const target of missing) {
    for (const statement of target.statements) {
      await deps.executeQuery(statement);
    }
  }
  deps.logger.info(
    `${ONE_TO_ONE_UNIQUES_STEP}: ${missing.map(t => `${t.entity.slug}.${t.field}`).join(", ")}.`
  );
  return missing.length;
}
