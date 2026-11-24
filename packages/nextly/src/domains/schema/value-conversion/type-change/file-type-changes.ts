/**
 * A migration file's field type changes, judged value by value against the database it is about
 * to run on, as a Schema Builder save's and a code-first apply's are: the same pairing of fields
 * (`fieldTypeChangesOf`), the same judgement of each stored value and the same refusals
 * (`fieldTypeChangeRefusals`), so a change refused in the Builder is refused in a file too.
 *
 * A file says what it changes in two places. Its snapshot records every entity's fields as the
 * file leaves them, and the newest snapshot before it records them as they were; its statements
 * rename columns. A type change that keeps its column writes no statement at all, so the two
 * snapshots are where it is read. A file run without snapshots on both sides (a hand-written one,
 * or one older than recorded fields) states no field types, and nothing is judged; a marked one is
 * refused instead, as its values could not be converted as its mark says (`unjudgeableMarkRefusal`).
 *
 * Asked by `nextly migrate` for each pending file, before the file's first statement, where the
 * files before it in the run have already applied and its values are as it will find them.
 *
 * A file whose header marks the columns it converts value by value (`readConvertsMark`, written by
 * a Schema Builder save that converted them) has those changes judged as converted, as the save
 * judged them: each value as the new type reads it, the values that cannot convert cleared where
 * the run's consent covers them (`--accept-data-loss`), and answers the conversion that writes them
 * on this database (`judgeFileTypeChanges`). Every other change keeps the cast's judgement.
 *
 * @module domains/schema/value-conversion/type-change/file-type-changes
 */
import { NextlyError } from "../../../../errors/nextly-error";
import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import {
  type ClearConsent,
  consentedRefusals,
  conversionRefusalsAsItStands,
  type TypeConversion,
  typeConversionOf,
} from "../../builder-save/type-conversion";
import {
  type ConvertedColumnName,
  unjudgeableMarkRefusal,
} from "../../migrate/converts-header";
import {
  ACCEPT_DATA_LOSS_FLAG,
  consentCovers,
  type DataLossConsent,
  NO_CONSENT,
} from "../../migrate/data-loss-consent";
import { DEFAULT_TABLE_NAME_RESOLVERS } from "../../migrate/resolved-schema";
import { renamesIn, tablesChangedIn } from "../../migrate/statement-targets";
import type {
  EntitySettingsRecord,
  RecordedEntitySettings,
  SettingsEntityKind,
} from "../../migrate-create/entity-settings";
import { conversionBetweenShapes } from "../../pipeline/diff/types";
import { builtByFor } from "../../pipeline/registered-collections";
import { mysqlLiveRunAt } from "../../pipeline/sql-templates/mysql-live-restate";
import {
  type ConfirmedColumnRename,
  renamedFieldsOf,
} from "../../pipeline/ui-type-changes";
import {
  fieldsStoredOnRow,
  type SupportedDialect,
} from "../../services/field-column-descriptor";

import { type ColumnAt, columnDescriptorAt } from "./field-type";
import {
  type EntityTypeChangeInput,
  entityLabel,
  type FieldTypeChange,
  fieldTypeChangesOf,
  judgeEntityTypeChanges,
  type JudgedFieldTypeChange,
  perLanguageAfter,
  perLanguageBefore,
  type TypeChangeRefusal,
  typeChangeError,
} from "./field-type-changes";

/** What a file states: the entities before it and after it, and its own statements. */
export interface FileTypeChangeSource {
  /** The file's name, which every refusal names. */
  filename: string;
  /** The entities the newest snapshot ordered before the file records. */
  before: EntitySettingsRecord | undefined;
  /** The entities the file's own snapshot records. */
  target: EntitySettingsRecord | undefined;
  /**
   * The UP statements, as the runner splits them, of every file the change between the two
   * snapshots is written in, in run order, for the renames they make: the migration's own and the
   * translation files `migrate:create` writes beside it, where a translated field's rename goes.
   * Judged before the first of them runs, while every old column still holds its values.
   */
  statements: readonly string[];
  dialect: SupportedDialect;
  /**
   * The fields each translations table's columns are retyped for by the change's own `retypes`
   * files, by the table's name lower-cased: a translated change is refused for its column only
   * where none of them gives it the new type.
   */
  retyped?: ReadonlyMap<string, ReadonlySet<string>>;
  /**
   * The columns the change's files convert value by value, as their marks name them
   * (`readConvertsMark`): each judged as converted. None where no file of the change is marked,
   * whose changes the cast converts.
   */
  converts?: readonly ConvertedColumnName[];
  /**
   * Where `converts` names each column: as the file's own run finds it, before the file's first
   * statement (`"before"`, the default, as the mark is written); or as `target` records it, for a
   * rollback judging the file's change in reverse from the columns the file left, whose mark still
   * names each as it was before the file. A field the file renames, or whose table it renames, is
   * then matched through the column it becomes there.
   */
  convertsNamedAt?: "before" | "target";
  /**
   * The run's consent to lose data (`--accept-data-loss`), which clears a converted column's
   * values that cannot convert where it covers that column. None, by default.
   */
  consent?: DataLossConsent;
}

/** One refusal of a file's type changes, with the entity it is of. */
export interface FileTypeChangeRefusal extends TypeChangeRefusal {
  entity: { kind: SettingsEntityKind; slug: string };
}

/** Each kind of entity, by the key a snapshot records it under. */
const KINDS = [
  ["collections", "collection"],
  ["singles", "single"],
  ["fieldGroups", "fieldGroup"],
] as const satisfies readonly (readonly [
  keyof EntitySettingsRecord,
  SettingsEntityKind,
])[];

/** An entity's table, as every migrate command spells it from its declaration. */
function tableOf(
  kind: SettingsEntityKind,
  slug: string,
  settings: RecordedEntitySettings["settings"]
): string {
  const dbName =
    typeof settings.dbName === "string" && settings.dbName !== ""
      ? settings.dbName
      : undefined;
  const entity = { slug, ...(dbName === undefined ? {} : { dbName }) };
  return kind === "collection"
    ? DEFAULT_TABLE_NAME_RESOLVERS.collection(entity)
    : kind === "single"
      ? DEFAULT_TABLE_NAME_RESOLVERS.single(entity)
      : DEFAULT_TABLE_NAME_RESOLVERS.component(entity);
}

/** A recorded declaration's fields, or undefined where it records none. */
function fieldsOf(
  recorded: RecordedEntitySettings
): FieldDefinition[] | undefined {
  const fields = recorded.settings.fields;
  return Array.isArray(fields) ? (fields as FieldDefinition[]) : undefined;
}

/**
 * The renames the statements make: each column's (a plain `RENAME COLUMN`, and on MySQL the
 * prepared run `migrate:create` writes to rename a column a check uses, which amounts to the plain
 * rename, `mysqlLiveRunAt`), and each table's new name by its old one, lower-cased as they are
 * read, in the order they run. The run's other statements rename nothing.
 */
function renamesMadeBy(
  statements: readonly string[],
  dialect: SupportedDialect
): { columns: ConfirmedColumnRename[]; tables: [string, string][] } {
  const columns: ConfirmedColumnRename[] = [];
  const tables: [string, string][] = [];
  statements.forEach((statement, at) => {
    const run =
      dialect === "mysql" ? mysqlLiveRunAt(statements, at) : undefined;
    if (run?.kind === "rename") {
      const { tableName, fromColumn, toColumn } = run;
      columns.push({ tableName, fromColumn, toColumn });
      return;
    }
    for (const rename of renamesIn(statement, dialect) ?? []) {
      if (rename.kind === "column") {
        columns.push({
          tableName: rename.table,
          fromColumn: rename.from,
          toColumn: rename.to,
        });
      } else {
        tables.push([rename.from, rename.to]);
      }
    }
  });
  return { columns, tables };
}

/**
 * Each field the save leaves dropped paired with the one it adds on the same column, where exactly
 * one of each names that column: two names that map to one column (`fooBar` and `foo_bar`) are a
 * rename with no statement, and the column keeps its values for the new field.
 */
function sameColumnRenames(
  previous: readonly FieldDefinition[],
  next: readonly FieldDefinition[],
  renamed: ReadonlyMap<string, string>,
  columnOf: (field: FieldDefinition) => string | undefined
): Map<string, string> {
  const renamedTo = new Set(renamed.values());
  const nextNames = new Set(fieldsStoredOnRow(next).map(f => f.name));
  const previousNames = new Set(fieldsStoredOnRow(previous).map(f => f.name));
  const byColumn = (
    fields: FieldDefinition[]
  ): Map<string, FieldDefinition[]> => {
    const map = new Map<string, FieldDefinition[]>();
    for (const field of fields) {
      const column = columnOf(field);
      if (column !== undefined)
        map.set(column, [...(map.get(column) ?? []), field]);
    }
    return map;
  };
  const dropped = byColumn(
    fieldsStoredOnRow(previous).filter(
      f => !nextNames.has(f.name) && !renamed.has(f.name)
    )
  );
  const added = byColumn(
    fieldsStoredOnRow(next).filter(
      f => !previousNames.has(f.name) && !renamedTo.has(f.name)
    )
  );
  const pairs = new Map<string, string>();
  for (const [column, [from, ...moreFrom]] of dropped) {
    const [to, ...moreTo] = added.get(column) ?? [];
    if (from && to && moreFrom.length === 0 && moreTo.length === 0) {
      pairs.set(from.name, to.name);
    }
  }
  return pairs;
}

/** An entity a snapshot records, with its slug and its table. */
interface RecordedEntity {
  slug: string;
  table: string;
  recorded: RecordedEntitySettings;
}

/** Each kind's entities in a snapshot, by their table, lower-cased. */
function entitiesByTable(
  record: EntitySettingsRecord,
  key: keyof EntitySettingsRecord,
  kind: SettingsEntityKind
): Map<string, RecordedEntity> {
  return new Map(
    Object.entries(record[key]).map(([slug, recorded]) => {
      const table = tableOf(kind, slug, recorded.settings);
      return [table.toLowerCase(), { slug, table, recorded }];
    })
  );
}

/**
 * Whether the file guards the whole of a relationship's change itself: a change of shape whose
 * guard refuses every held link (`requireEmpty`), or one whose conversion carries the links into
 * the new shape with the same targets. A conversion carrying links to other targets (an author's
 * id wrapped into a list of media ids) guards only the shape, so the change is judged here.
 */
function guardedByTheFile(change: FieldTypeChange): boolean {
  const was = change.fromType.relation;
  const now = change.toType.relation;
  if (was === undefined || now === undefined) return false;
  if (was.kept === "join" || now.kept === "join") return false;
  const conversion = conversionBetweenShapes(was.kept, now.kept);
  if (conversion === undefined) return false;
  if (conversion === "requireEmpty") return true;
  return (
    was.upload === now.upload &&
    was.targets.length === now.targets.length &&
    was.targets.every((target, i) => target === now.targets[i])
  );
}

/**
 * Each table the file leaves renamed, by the name it had before the file, following the renames in
 * the order they run: a table renamed twice keeps its first name. A table the file made itself and
 * renamed into place (SQLite's rebuild writes `__new_<table>` and renames it over the table) is
 * no table of the entity before, so it never replaces the name the table had, whether the table
 * was renamed before the rebuild or is renamed after it.
 */
function tablesBefore(
  renames: readonly (readonly [string, string])[],
  before: EntitySettingsRecord
): Map<string, string> {
  const known = new Set(
    KINDS.flatMap(([key, kind]) => [
      ...entitiesByTable(before, key, kind).keys(),
    ])
  );
  const origin = new Map<string, string>();
  for (const [from, to] of renames) {
    const first = origin.get(from) ?? from;
    origin.delete(from);
    if (!known.has(first) && (origin.has(to) || known.has(to))) continue;
    origin.set(to, first);
  }
  return origin;
}

/**
 * The entities whose field types the file changes, each as the type-change precondition reads it:
 * an entity both snapshots record, whose fields, paired by name or by a rename the file's
 * statements make, change type with a column on both sides. An entity the file adds or removes,
 * one whose fields either snapshot does not record, and one whose types the file leaves alone are
 * not among them, and read no row.
 */
export function fileTypeChangesOf(
  source: FileTypeChangeSource
): FileEntityTypeChange[] {
  const { before, target, dialect } = source;
  if (before === undefined || target === undefined) return [];
  const renames = renamesMadeBy(source.statements, dialect);
  const tableBefore = tablesBefore(renames.tables, before);
  return KINDS.flatMap(([key, kind]) => {
    // Paired by their table, not their slug: a slug the file renames keeps its table where it
    // states one (`dbName`), and a table the file renames is paired through the rename.
    const beforeByTable = entitiesByTable(before, key, kind);
    const paired = new Set<RecordedEntity>();
    const unpaired: {
      slug: string;
      table: string;
      after: RecordedEntitySettings;
    }[] = [];
    const changes = Object.entries(target[key]).flatMap(([slug, after]) => {
      const table = tableOf(kind, slug, after.settings);
      const was = recordedBefore(beforeByTable, tableBefore, table);
      if (was === undefined) {
        unpaired.push({ slug, table, after });
        return [];
      }
      paired.add(was);
      return entityTypeChange({
        kind,
        slug,
        table,
        was,
        after,
        source,
        renames,
      });
    });
    return [
      ...changes,
      ...unpairedTypeChanges({
        kind,
        source,
        unpaired,
        unpairedBefore: [...beforeByTable.values()].filter(e => !paired.has(e)),
      }),
    ];
  });
}

/**
 * Where `kind`'s fields are kept, as their columns are made: the creator of its tables, and for a
 * field group its own rows, where a many-to-many keeps its links as a JSON list in a column of its
 * own rather than in a junction table. Every question this file asks of a field's column or type
 * is asked at it, so a field group's many-to-many is judged as the column it is.
 */
function columnAtFor(
  kind: SettingsEntityKind,
  after: RecordedEntitySettings
): ColumnAt {
  return {
    builtBy: builtByFor(kind, after.source === "builder"),
    ...(kind === "fieldGroup" ? { componentRow: true } : {}),
  };
}

/** One entity whose field types the file changes, as `fileTypeChangesOf` gives it. */
interface FileEntityTypeChange {
  kind: SettingsEntityKind;
  slug: string;
  input: EntityTypeChangeInput;
  /** The fields an unread rename on the entity's table may carry values to (`unreadRenameFields`). */
  unread?: { table: string; fields: string[] };
}

/**
 * The record the earlier snapshot keeps for the entity now on `table`: through a rename only from a
 * table that snapshot records (SQLite's rebuild renames its scratch copy, `__new_<table>`, to the
 * table's own name, which is no other entity's), else under the same table.
 */
function recordedBefore(
  beforeByTable: ReadonlyMap<string, RecordedEntity>,
  tableBefore: ReadonlyMap<string, string>,
  table: string
): RecordedEntity | undefined {
  const key = table.toLowerCase();
  return (
    beforeByTable.get(tableBefore.get(key) ?? "") ?? beforeByTable.get(key)
  );
}

/** One entity's field type changes, between its record before the file and after it. */
function entityTypeChange(args: {
  kind: SettingsEntityKind;
  slug: string;
  table: string;
  was: RecordedEntity;
  after: RecordedEntitySettings;
  source: FileTypeChangeSource;
  renames: ReturnType<typeof renamesMadeBy>;
}): FileEntityTypeChange[] {
  const { kind, slug, table, after, source, renames } = args;
  const { dialect } = source;
  const previous = fieldsOf(args.was.recorded);
  const next = fieldsOf(after);
  if (previous === undefined || next === undefined) return [];
  // Read where the values are before the file runs: under the table's old name where the file
  // renames it, since this is asked before its first statement.
  const readFrom = args.was.table;
  const translationsTable = `${readFrom}_locales`;
  const at = columnAtFor(kind, after);
  const columnOf = (field: FieldDefinition) =>
    columnDescriptorAt(field, dialect, at)?.name.toLowerCase();
  // A column rename names the table by whichever name it has when the rename runs.
  const tables = new Set(
    [table, `${table}_locales`, readFrom, translationsTable].map(t =>
      t.toLowerCase()
    )
  );
  const stated = renamedFieldsOf(
    previous,
    next,
    renames.columns,
    tables,
    columnOf
  );
  const renamed = new Map([
    ...stated,
    ...sameColumnRenames(previous, next, stated, columnOf),
  ]);
  // The old columns as the old owner made them: an entity the file moves between the Schema
  // Builder and code (a Builder's unbounded text becoming code's bounded one) changes type there.
  const builtByBefore = columnAtFor(kind, args.was.recorded).builtBy;
  const changes = fieldTypeChangesOf({
    previous,
    next,
    ...(renamed.size > 0 ? { renamed } : {}),
    dialect,
    ...at,
    ...(builtByBefore !== at.builtBy ? { builtByBefore } : {}),
    // A field inside a named group or a repeater too: the file changes no column for it, so its
    // values are judged where the file runs, as the save that wrote it judged them.
    nested: true,
  });
  const unread = unreadRenameFields({
    statements: source.statements,
    dialect,
    tables,
    previous,
    next,
    renamed,
    at,
  });
  if (changes.length === 0 && unread.length === 0) return [];
  // A relationship whose links change where they are kept is the file's own to answer for: the
  // diff writes it as the guarded conversion `conversionBetweenShapes` names (a reference list's,
  // a single reference's, or the guard that refuses a held link), which runs first with its own
  // message on every database. Any other change, a relationship becoming another type or one
  // keeping its shape under other targets (a relationship becoming an upload), is judged here: no
  // statement of the file converts or guards it. Never one held inside JSON, which no statement
  // converts: it stays judged under its path, and its own name names no field on the row.
  const relationsShaped = new Set(
    changes
      .filter(change => change.within === undefined && guardedByTheFile(change))
      .map(change => change.to.name)
  );
  return [
    {
      kind,
      slug,
      ...(unread.length > 0 ? { unread: { table, fields: unread } } : {}),
      input: {
        label: `${entityLabel(kind, slug)} (migration ${source.filename})`,
        table: readFrom,
        // A field translated before the file keeps each language's value in the companion;
        // a file that turns translation on or off has the values where they were, so the
        // companion is always named and each value read from whichever table holds it.
        translationsTable,
        ...perLanguageBefore(args.was.recorded.settings, readFrom, previous),
        ...perLanguageAfter(after.settings, next),
        previous,
        next,
        ...(renamed.size > 0 ? { renamed } : {}),
        ...(relationsShaped.size > 0 ? { ignore: relationsShaped } : {}),
        ...(builtByBefore !== at.builtBy ? { builtByBefore } : {}),
        ...retypedOf(source, [translationsTable, `${table}_locales`]),
        ...convertedOf(source, { readFrom, table, changes, columnOf }),
        ...at,
      },
    },
  ];
}

/**
 * The columns a marked change rewrites (`EntityTypeChangeInput.rewrites`): those its marks name,
 * by table and column, as the database spells them in either case, where the values are read
 * before the first statement. A mark naming the columns as `target` holds them
 * (`convertsNamedAt`) names them through the fields they become (`heldThroughTarget`). Nothing
 * for an unmarked one.
 */
function convertedOf(
  source: FileTypeChangeSource,
  entity: EntityNames
): Pick<EntityTypeChangeInput, "rewrites"> {
  const named = new Set(
    (source.converts ?? []).map(c => columnKey(c.table, c.column))
  );
  if (named.size === 0) return {};
  const held =
    source.convertsNamedAt === "target"
      ? heldThroughTarget(named, entity)
      : named;
  return { rewrites: (table, column) => held.has(columnKey(table, column)) };
}

/** An entity's tables and changed fields, as `entityTypeChange` reads them. */
interface EntityNames {
  /** The table its values are read from, before the first statement. */
  readFrom: string;
  /** Its table as `target` records it. */
  table: string;
  changes: readonly FieldTypeChange[];
  /** A field's column, lower-cased. */
  columnOf: (field: FieldDefinition) => string | undefined;
}

/** A column's key in a set of columns: its table and name, lower-cased. */
function columnKey(table: string, column: string): string {
  return `${table}.${column}`.toLowerCase();
}

/**
 * The columns, where the values are read before the first statement, of the changed fields whose
 * columns as `target` holds them `named` names: on the entity's table, or on its translations
 * table, each through the field it becomes. A field held inside JSON is never marked.
 */
function heldThroughTarget(
  named: ReadonlySet<string>,
  entity: EntityNames
): Set<string> {
  const held = new Set<string>();
  const tables = [
    [entity.readFrom, entity.table],
    [`${entity.readFrom}_locales`, `${entity.table}_locales`],
  ] as const;
  for (const change of entity.changes) {
    if (change.within !== undefined) continue;
    const from = entity.columnOf(change.from);
    const to = entity.columnOf(change.to);
    if (from === undefined || to === undefined) continue;
    for (const [heldIn, namedIn] of tables) {
      if (named.has(columnKey(namedIn, to))) held.add(columnKey(heldIn, from));
    }
  }
  return held;
}

/** The fields the change's `retypes` files retype in the first of `tables` they name. */
function retypedOf(
  source: FileTypeChangeSource,
  tables: readonly string[]
): Pick<EntityTypeChangeInput, "retypedTranslations"> {
  for (const table of tables) {
    const fields = source.retyped?.get(table.toLowerCase());
    if (fields !== undefined) return { retypedTranslations: fields };
  }
  return {};
}

/**
 * Whether the statements rename something on `tables` (lower-cased) in a way not read here: a
 * `RENAME` that neither `renamesIn` nor MySQL's run reader (`mysqlLiveRunAt`) reads, on one of
 * them, or on tables not read at all, which may be any of them.
 */
function unreadRenameOn(
  statements: readonly string[],
  dialect: SupportedDialect,
  tables: ReadonlySet<string>
): boolean {
  return statements.some((statement, at) => {
    if (!/\bRENAME\b/i.test(statement)) return false;
    if (dialect === "mysql" && mysqlLiveRunAt(statements, at) !== undefined) {
      return false;
    }
    if (renamesIn(statement, dialect) !== undefined) return false;
    const touched = tablesChangedIn(statement, dialect);
    return (
      touched === undefined ||
      touched.some(table => tables.has(table.toLowerCase()))
    );
  });
}

/**
 * Entities the file may rename in a way not read here, refused rather than taken for one entity
 * dropped and another added: an entity the later snapshot records that pairs with none before it,
 * beside one before it that pairs with none after, where an unread rename (`unreadRenameOn`) may
 * reach either's table. Each field of the later entity whose type differs from a field of the same
 * name on an unpaired earlier one is refused, since the rename may carry its values to a type that
 * cannot read them. An entity added with no such rename beside it is not judged.
 */
function unpairedTypeChanges(args: {
  kind: SettingsEntityKind;
  source: FileTypeChangeSource;
  unpaired: readonly {
    slug: string;
    table: string;
    after: RecordedEntitySettings;
  }[];
  unpairedBefore: readonly RecordedEntity[];
}): FileEntityTypeChange[] {
  const { kind, source, unpairedBefore } = args;
  const { dialect } = source;
  if (args.unpaired.length === 0 || unpairedBefore.length === 0) return [];
  return args.unpaired.flatMap(({ slug, table, after }) => {
    const next = fieldsOf(after);
    if (next === undefined) return [];
    const tables = new Set(
      [table, ...unpairedBefore.map(e => e.table)].flatMap(t => [
        t.toLowerCase(),
        `${t}_locales`.toLowerCase(),
      ])
    );
    if (!unreadRenameOn(source.statements, dialect, tables)) return [];
    const at = columnAtFor(kind, after);
    const fields = fieldsStoredOnRow(next)
      .filter(to =>
        unpairedBefore.some(was =>
          fieldsStoredOnRow(fieldsOf(was.recorded) ?? []).some(
            from =>
              from.name === to.name &&
              fieldTypeChangesOf({
                previous: [from],
                next: [to],
                dialect,
                ...at,
              }).length > 0
          )
        )
      )
      .map(field => field.name);
    if (fields.length === 0) return [];
    return [
      {
        kind,
        slug,
        unread: { table, fields },
        input: {
          label: `${entityLabel(kind, slug)} (migration ${source.filename})`,
          table,
          previous: [],
          next: [],
          ...at,
        },
      },
    ];
  });
}

/**
 * The fields an unread rename may carry values to, where the statements rename something on the
 * entity's tables in a way not read here (`renamesIn` reads no quoted PostgreSQL name in another
 * case than lower): each field the file adds, left unpaired, whose type differs from a field it
 * drops. Such a rename may give the new field the old one's values under a type that cannot read
 * them, so it is refused rather than taken for a drop and an add.
 */
function unreadRenameFields(args: {
  statements: readonly string[];
  dialect: SupportedDialect;
  tables: ReadonlySet<string>;
  previous: readonly FieldDefinition[];
  next: readonly FieldDefinition[];
  renamed: ReadonlyMap<string, string>;
  /** Where the fields are kept, as their columns are made (`columnAtFor`). */
  at: ColumnAt;
}): string[] {
  const { dialect } = args;
  if (!unreadRenameOn(args.statements, dialect, args.tables)) return [];
  const renamedTo = new Set(args.renamed.values());
  const nextNames = new Set(fieldsStoredOnRow(args.next).map(f => f.name));
  const previousNames = new Set(
    fieldsStoredOnRow(args.previous).map(f => f.name)
  );
  const dropped = fieldsStoredOnRow(args.previous).filter(
    f => !nextNames.has(f.name) && !args.renamed.has(f.name)
  );
  const added = fieldsStoredOnRow(args.next).filter(
    f => !previousNames.has(f.name) && !renamedTo.has(f.name)
  );
  // A type change were the dropped field renamed to the added one: the same pairing the
  // judgement makes (`fieldTypeChangesOf`), asked of each candidate pair.
  return added
    .filter(to =>
      dropped.some(
        from =>
          fieldTypeChangesOf({
            previous: [from],
            next: [{ ...to, name: from.name }],
            dialect,
            ...args.at,
          }).length > 0
      )
    )
    .map(field => field.name);
}

/**
 * Every refusal of the file's field type changes, judged on the values the database holds now:
 * each blocked change, and each change that would lose a value, since a file clears no value its
 * new type cannot read unless it converts that column (`converts`) and the run's consent covers
 * it. Empty where the file changes no field type, or every value is kept. Each names its entity,
 * the field and the file. A file renaming on an entity's table in a way not read here, beside
 * fields it drops and adds with another type, is refused without reading a row: the pairs cannot
 * be told, so nothing would be judged.
 */
export async function fileTypeChangeRefusals(
  db: unknown,
  source: FileTypeChangeSource
): Promise<FileTypeChangeRefusal[]> {
  return (await judgeFileTypeChanges(db, source)).refusals;
}

/** What `judgeFileTypeChanges` answers: the refusals, and the conversion of each entity's values. */
export interface FileTypeChangeJudgement {
  refusals: FileTypeChangeRefusal[];
  /**
   * The conversion of each entity's columns the file converts value by value, judged clear of
   * refusals or not: run before the first statement that changes each table, it judges them
   * again where it runs (`TypeConversion.run`).
   */
  conversions: TypeConversion[];
}

/**
 * Refuse a marked file whose snapshots do not both record the fields: a marked change is converted
 * as its mark says, or refused, and one that cannot be judged is never left to the database's cast
 * instead.
 *
 * @throws {NextlyError} a validation error (`unjudgeableMarkRefusal`)
 */
function refuseUnjudgeableMark(source: FileTypeChangeSource): void {
  if ((source.converts ?? []).length === 0) return;
  if (source.before === undefined || source.target === undefined) {
    throw unjudgeableMarkRefusal(source.filename);
  }
}

/**
 * The file's field type changes judged on the values the database holds now: their refusals
 * (`fileTypeChangeRefusals`), and for a change whose file converts its values, the conversion
 * that writes them, with the run's consent to clear those that cannot convert.
 */
export async function judgeFileTypeChanges(
  db: unknown,
  source: FileTypeChangeSource
): Promise<FileTypeChangeJudgement> {
  refuseUnjudgeableMark(source);
  const refusals: FileTypeChangeRefusal[] = [];
  const conversions: TypeConversion[] = [];
  for (const { kind, slug, input, unread } of fileTypeChangesOf(source)) {
    for (const field of unread?.fields ?? []) {
      refusals.push({
        path: field,
        code: "TYPE_CHANGE_BLOCKED",
        message:
          `${input.label}: the migration renames on table ${unread?.table} in a way that could not ` +
          `be read, beside field '${field}' of another type than a field it drops, so whether ` +
          `'${field}' takes a dropped field's values cannot be judged. Write the rename as ` +
          `\`ALTER TABLE … RENAME COLUMN\` on the table's lower-case name, or change the field's ` +
          `name and its type in separate migrations.`,
        entity: { kind, slug },
      });
    }
    const judged = await judgeEntityTypeChanges(db, source.dialect, input);
    const consent = runConsentOf(source, input);
    const entityRefusals =
      input.rewrites === undefined
        ? judged.refusals
        : consentedRefusals(input.label, judged.judged, consent).refusals;
    const converted = await conversionOf(db, source.dialect, input, {
      judged: judged.judged,
      consent,
    });
    for (const refusal of [...entityRefusals, ...converted.refusals]) {
      refusals.push({ ...refusal, entity: { kind, slug } });
    }
    if (converted.conversion !== undefined) {
      conversions.push(converted.conversion);
    }
  }
  return { refusals, conversions };
}

/**
 * The conversion of a marked entity's judged changes, where any converts, and its refusals beyond
 * their values (`conversionRefusalsAsItStands`), asked before the change's first file.
 */
async function conversionOf(
  db: unknown,
  dialect: SupportedDialect,
  input: EntityTypeChangeInput,
  of: { judged: readonly JudgedFieldTypeChange[]; consent: ClearConsent }
): Promise<{
  conversion?: TypeConversion;
  refusals: TypeChangeRefusal[];
}> {
  // A file with no mark converts nothing: the database's cast changes its columns.
  if (input.rewrites === undefined) return { refusals: [] };
  const conversion = typeConversionOf({ dialect, input, ...of });
  if (conversion === undefined) return { refusals: [] };
  return {
    conversion,
    refusals: await conversionRefusalsAsItStands(
      db,
      dialect,
      input.label,
      conversion,
      of.judged
    ),
  };
}

/**
 * How a run's consent clears a converted column's values that cannot convert (`ClearConsent`): a
 * deletion of that column's values, which `--accept-data-loss` covers without targets, or naming
 * the column, its table, or, for a translations table, the entity's own table; and how the run's
 * refusal asks for it.
 */
function runConsentOf(
  source: FileTypeChangeSource,
  input: EntityTypeChangeInput
): ClearConsent {
  const consent = source.consent ?? NO_CONSENT;
  return {
    kind: "run",
    covers: change => consentCovers(consent, clearOf(change, input)),
    clearsBy: change =>
      `Run it again with ${ACCEPT_DATA_LOSS_FLAG}=${change.table}.${change.column} to clear the ` +
      `${String(change.result.cleared.length)} value(s) that cannot convert, as the save that wrote ` +
      `it cleared those its database held.`,
  };
}

/** A converted change's clearing, as the run's consent judges a deletion of a column's values. */
function clearOf(
  change: JudgedFieldTypeChange,
  input: EntityTypeChangeInput
): Parameters<typeof consentCovers>[1] {
  return {
    kind: "column",
    table: change.table,
    column: change.column,
    count: change.result.cleared.length,
    reason: `values that cannot convert to ${change.to.type}`,
    ...(change.table === input.table ? {} : { owner: input.table }),
  };
}

/**
 * Refuse the file before its first statement where any of its field type changes is blocked or
 * would lose a value (`fileTypeChangeRefusals`), naming every refusal at once. Answers the
 * conversion of each entity's values its marks convert (`judgeFileTypeChanges`), for the run to
 * write before the first statement that changes each of their tables.
 *
 * @throws {NextlyError} a validation error listing each refusal, with its entity and field
 */
export async function refuseFileTypeChanges(
  db: unknown,
  source: FileTypeChangeSource
): Promise<TypeConversion[]> {
  const { refusals, conversions } = await judgeFileTypeChanges(db, source);
  throwFileTypeChangeRefusals(source.filename, refusals);
  return conversions;
}

/**
 * Throw a file's type change refusals (`judgeFileTypeChanges`) as one validation error, each with
 * its entity and field, where there are any: the error `refuseFileTypeChanges` throws, for a
 * caller that judged the file itself (a rollback, which lists the judgement in its dry run).
 *
 * @throws {NextlyError} a validation error listing each refusal
 */
export function throwFileTypeChangeRefusals(
  filename: string,
  refusals: readonly FileTypeChangeRefusal[]
): void {
  if (refusals.length === 0) return;
  throw NextlyError.validation({
    errors: refusals.map(refusal => typeChangeError(refusal)),
    logContext: {
      file: filename,
      entities: [
        ...new Set(refusals.map(r => `${r.entity.kind}:${r.entity.slug}`)),
      ],
      fields: refusals.map(refusal => refusal.path),
    },
  });
}
