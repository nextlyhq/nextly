/**
 * How many values a save that removes fields deletes, counted one way for the review the person
 * confirms and for the save that deletes them, and the save's check that the two agree.
 *
 * The review counts each removed field's values when it opens (`computeNonNullCounts`). A save
 * given the counts the person confirmed counts again inside its own migration file's transaction,
 * before the statements that delete them, with the tables held against other writes, and deletes
 * only where every count still equals the confirmed one (`deletionHoldOf`). On PostgreSQL the
 * tables are locked against writes and left open to reads (`SHARE ROW EXCLUSIVE`); on SQLite the
 * file's transaction already holds the database's one write lock. On MySQL, whose schema
 * statements commit on their own, no transaction holds the count and the drop together: the save
 * holds the collection on the try's connection instead (its named locks and registry row, as a
 * collection delete does), counts under that hold just before the statements, and lets it go once
 * the try is over (`triedHoldOf` in the collection save), so entry writes wait for it. A
 * save applied by a push rather than its file (a translated collection in development, or an app
 * with no file writer) is compared the same way, just before the push, with the collection held
 * from before the count until its registry row is written (`saveHoldScope`). A many-to-many's
 * links are counted in its link table, which goes with them.
 *
 * @module domains/schema/builder-save/deletion-counts
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { sql, type SQL } from "drizzle-orm";

import { isVirtualField } from "../../../collections/fields/virtual";
import { NextlyError } from "../../../errors/nextly-error";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import { isFieldLocalized } from "../../i18n/classify-fields";
import { storesPerLanguage } from "../../i18n/per-language-storage";
import {
  countNonEmpty,
  countRowsBreakingNotNull,
} from "../pipeline/classifier/count-helpers";
import { quoteIdent } from "../pipeline/sql-templates/identifier-quoting";
import {
  fieldProducesColumn,
  fieldsStoredOnRow,
  junctionTableNameFor,
  toSnakeCase,
  usesJunctionTable,
} from "../services/field-column-descriptor";
import { linkMoveOf } from "../services/field-storage-moves";

/** A removed field's values, as far as they could be counted. */
export interface RemovedCount {
  rowCount: number;
  /** True when the count could not be read: never taken for an empty column. */
  unknown: boolean;
}

export const UNCOUNTED: RemovedCount = { rowCount: 0, unknown: true };

/** How many values of a removed field the person confirmed deleting, by the field's name. */
export interface ConfirmedDeletion {
  field: string;
  count: number;
}

/**
 * The table a removed field's values are stored in, for an entity translated or not (`localized`):
 * the entity's translations table for a translated field where the entity keeps those in it
 * (`storesPerLanguage`: a translated entity, and every entity under per-language storage), its own
 * table for every other field.
 */
function valuesTableOf(
  tableName: string,
  localized: boolean,
  field: FieldDefinition
): string {
  return isFieldLocalized(field, storesPerLanguage({ localized }))
    ? `${tableName}${STORAGE_FORMAT.companionSuffix}`
    : tableName;
}

/**
 * Count each removed field's non-null values where they are stored:
 * - a field with no storage (a virtual field) holds nothing;
 * - a many-to-many relationship's links are counted in its link table
 *   (`countJunctionLinks`), which goes with it;
 * - a field whose values live in a table of their own otherwise (a field
 *   group) is not counted here, so its count is unknown;
 * - a translated field is counted in the companion table, across its
 *   languages, where the entity keeps it there (`valuesTableOf`); every other
 *   field on the main table;
 * - the column is the field's stored column name, not its name as written,
 *   and the names are quoted as identifiers (`countNonEmpty`), so a table
 *   named with a hyphen is counted.
 * Any count that fails is unknown, never 0.
 */
export async function computeNonNullCounts(
  db: unknown,
  dialect: SupportedDialect,
  tableName: string,
  localized: boolean,
  removed: FieldDefinition[]
): Promise<Record<string, RemovedCount>> {
  const counts: Record<string, RemovedCount> = {};

  for (const field of removed) {
    if (isVirtualField(field)) {
      counts[field.name] = { rowCount: 0, unknown: false };
      continue;
    }
    if (!fieldProducesColumn(field)) {
      counts[field.name] = usesJunctionTable(field)
        ? await countJunctionLinks(db, dialect, tableName, field)
        : UNCOUNTED;
      continue;
    }
    const table = valuesTableOf(tableName, localized, field);
    try {
      counts[field.name] = {
        rowCount: await countNonEmpty(
          db,
          dialect,
          table,
          toSnakeCase(field.name)
        ),
        unknown: false,
      };
    } catch {
      counts[field.name] = UNCOUNTED;
    }
  }
  return counts;
}

/** The links a many-to-many's link table holds, or unknown where they cannot be counted. */
export async function countJunctionLinks(
  db: unknown,
  dialect: SupportedDialect,
  tableName: string,
  field: FieldDefinition
): Promise<RemovedCount> {
  try {
    const { total } = await countRowsBreakingNotNull(db, dialect, {
      table: junctionTableNameFor(tableName, field),
      column: null,
    });
    return { rowCount: total, unknown: false };
  } catch {
    return UNCOUNTED;
  }
}

/** A save's count of what it deletes, taken where its statements run, and the tables it reads. */
export interface DeletionHold {
  /** The tables the removed fields' values are stored in, which the count reads and holds. */
  readonly tables: readonly string[];
  /**
   * Holds `tables` against other writes where the database can (PostgreSQL), counts the removed
   * fields' values through `db`, the handle the save's statements run on, and refuses the save
   * where a count differs from the one confirmed. Run before the statements that delete them.
   */
  readonly check: (db: unknown) => Promise<void>;
  /**
   * Counts and compares as `check` does, holding nothing: for a save whose statements run where no
   * transaction of its own holds the count and the delete together (a push), just before them. A
   * write between the two is not held off.
   */
  readonly compare: (db: unknown) => Promise<void>;
  /**
   * `check` for the removed fields whose values are stored in `changed`, the tables one migration
   * file's statements change, holding those tables alone: undefined where none of them holds a
   * removed field's values. Each file that deletes values counts them in its own transaction, so
   * a file that runs before it, and commits, takes no part of the count.
   */
  readonly checkIn: (
    changed: readonly string[]
  ) => ((db: unknown) => Promise<void>) | undefined;
  /**
   * `compare` for a try that resumes past statements that committed (MySQL's schema statements),
   * for the removed fields stored in `changed` (every one where absent) whose column the database
   * still holds: a field an earlier try's statements dropped was counted under that try's hold, and
   * its values are gone with its column. A column that cannot be looked up is counted, so a count
   * that cannot be taken refuses as it does before the first statement.
   */
  readonly standingIn: (
    changed?: readonly string[]
  ) => (db: unknown) => Promise<void>;
}

/**
 * Whether `table` still has `column`, read through `db` on MySQL, the one database whose saves
 * resume past statements that committed; elsewhere, and where the lookup fails, it is taken to
 * stand, so it is counted.
 */
async function columnStands(
  db: unknown,
  dialect: SupportedDialect,
  table: string,
  column: string
): Promise<boolean> {
  if (dialect !== "mysql") return true;
  try {
    const result = await (db as Executes).execute(
      sql`SELECT COUNT(*) AS ${sql.identifier("count")} FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${table} AND COLUMN_NAME = ${column}`
    );
    const [rows] = result as [Array<{ count: unknown }>];
    return Number(rows[0]?.count) > 0;
  } catch {
    return true;
  }
}

/**
 * Whether `table` still stands, read through `db` on MySQL, as `columnStands` reads a column; a
 * link table dropped by an earlier try's statements took its links with it. Elsewhere, and where
 * the lookup fails, it is taken to stand, so it is counted.
 */
async function tableStands(
  db: unknown,
  dialect: SupportedDialect,
  table: string
): Promise<boolean> {
  if (dialect !== "mysql") return true;
  try {
    const result = await (db as Executes).execute(
      sql`SELECT COUNT(*) AS ${sql.identifier("count")} FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${table}`
    );
    const [rows] = result as [Array<{ count: unknown }>];
    return Number(rows[0]?.count) > 0;
  } catch {
    return true;
  }
}

/** The handle a statement is run through, as Drizzle gives it on PostgreSQL. */
interface Executes {
  execute(query: SQL): Promise<unknown>;
}

/**
 * The removed fields' values counted and compared with what the person confirmed, for a save of
 * the entity stored in `tableName` from `previous` to `next` fields; undefined where the save was
 * given no confirmed counts, which it then deletes as before, or removes no field stored in a
 * column. Every removed field stored in a column is compared, so one the confirmation leaves out
 * counts as confirmed at 0, and is refused if it holds any value.
 *
 * A field is removed where its column goes: the fields stored on the row (`fieldsStoredOnRow`, so
 * a field inside a group with no name counts as the row's own) in a column before the save and in
 * none after it, whether gone or changed to a shape with no column, apart from those the save
 * renames (`renamed`), whose values the save keeps.
 */
export function deletionHoldOf(args: {
  dialect: SupportedDialect;
  tableName: string;
  /** Whether the entity is translated before the save, which decides where its values are. */
  localized: boolean;
  previous: readonly FieldDefinition[];
  next: readonly FieldDefinition[];
  /** The fields the save renames, by name before and after: kept, with their values. */
  renamed?: ReadonlyArray<{ from: string; to: string }>;
  confirmed: readonly ConfirmedDeletion[] | undefined;
}): DeletionHold | undefined {
  const { dialect, tableName, localized, confirmed } = args;
  if (confirmed === undefined) return undefined;
  // By column, as the save's statements name them: a name written in another case or spelling
  // is the same column.
  const columnOf = (name: string): string => toSnakeCase(name);
  // A field stored in a column of the row, by the shared rule (`fieldProducesColumn`); a virtual
  // field stores nothing.
  const inAColumn = (field: FieldDefinition): boolean =>
    !isVirtualField(field) && fieldProducesColumn(field);
  // Kept: a column the save leaves, which a field after it still stores in. A field that keeps its
  // name but no longer has a column (a relationship made many-to-many, a field made virtual) keeps
  // nothing: its column goes.
  const before = new Set(
    fieldsStoredOnRow(args.previous)
      .filter(inAColumn)
      .map(field => columnOf(field.name))
  );
  const after = new Set(
    fieldsStoredOnRow(args.next)
      .filter(inAColumn)
      .map(field => columnOf(field.name))
  );
  // A rename keeps its column's values only where the save makes it one: a column that goes, and a
  // column that comes in its place, as the pipeline pairs a drop with an add. Any other rename
  // answer renames nothing, and its column, if it goes, is compared like any other.
  const renamedAway = (args.renamed ?? [])
    .map(rename => ({ from: columnOf(rename.from), to: columnOf(rename.to) }))
    .filter(
      rename =>
        before.has(rename.from) &&
        !after.has(rename.from) &&
        after.has(rename.to) &&
        !before.has(rename.to)
    )
    .map(rename => rename.from);
  const kept = new Set([...after, ...renamedAway]);
  // The links a many-to-many's link table holds go with it where the save removes the field, or
  // keeps it by name but moves its links out of the table or to another (`linkMoveOf`): counted
  // in that table, as a column's values are counted in their column. A field renamed is kept.
  const nextByName = new Map(
    fieldsStoredOnRow(args.next).map(field => [field.name, field])
  );
  const renamedFrom = new Set((args.renamed ?? []).map(rename => rename.from));
  const linksDropped = fieldsStoredOnRow(args.previous).filter(field => {
    if (!usesJunctionTable(field)) return false;
    const after = nextByName.get(field.name);
    if (after === undefined) return !renamedFrom.has(field.name);
    const move = linkMoveOf(field, after);
    return move === "leaving" || move === "retargeted";
  });
  const removed = [
    ...fieldsStoredOnRow(args.previous).filter(
      field => inAColumn(field) && !kept.has(columnOf(field.name))
    ),
    ...linksDropped,
  ];
  if (removed.length === 0) return undefined;
  // Where each removed field's values are: its link table, or the column's table (`valuesTableOf`).
  const storedIn = (field: FieldDefinition): string =>
    usesJunctionTable(field)
      ? junctionTableNameFor(tableName, field)
      : valuesTableOf(tableName, localized, field);
  const tables = [...new Set(removed.map(storedIn))];
  const confirmedOf = new Map(
    confirmed.map(entry => [entry.field, entry.count])
  );
  // The removed fields among `fields`, counted and compared.
  const compareOf = (fields: FieldDefinition[]) => async (db: unknown) => {
    const counts = await computeNonNullCounts(
      db,
      dialect,
      tableName,
      localized,
      fields
    );
    const changed = fields.flatMap(field => {
      const counted = counts[field.name] ?? UNCOUNTED;
      const confirmedCount = confirmedOf.get(field.name) ?? 0;
      return counted.unknown || counted.rowCount !== confirmedCount
        ? [{ field: field.name, counted, confirmedCount }]
        : [];
    });
    if (changed.length === 0) return;
    throw NextlyError.validation({
      errors: changed.map(({ field, counted, confirmedCount }) => ({
        path: `fields.${field}`,
        code: "DELETION_COUNT_CHANGED",
        message: counted.unknown
          ? `The values of ${field} could not be counted again, so nothing was deleted. Review the change and save again.`
          : `${field} now holds ${String(counted.rowCount)} value(s), not the ${String(confirmedCount)} confirmed, so nothing was deleted. Review the new count and save again.`,
      })),
      logContext: {
        reason: "deletion-count-changed",
        table: tableName,
        fields: changed.map(({ field, counted, confirmedCount }) => ({
          field,
          counted: counted.unknown ? null : counted.rowCount,
          confirmed: confirmedCount,
        })),
      },
    });
  };
  // `fields` counted and compared with `held` held first, where the database can.
  const checkOf =
    (fields: FieldDefinition[], held: readonly string[]) =>
    async (db: unknown): Promise<void> => {
      if (dialect === "postgresql") {
        // Other sessions' writes to the tables wait from here until the save's transaction ends;
        // their reads go on. A held table ends the try under the try's own lock timeout.
        for (const table of held) {
          await (db as Executes).execute(
            sql.raw(
              `LOCK TABLE ${quoteIdent(table, dialect)} IN SHARE ROW EXCLUSIVE MODE`
            )
          );
        }
      }
      await compareOf(fields)(db);
    };
  // The removed fields stored in `changed`, every one where absent.
  const removedIn = (changed: readonly string[] | undefined) => {
    if (changed === undefined) return removed;
    const inThem = new Set(changed.map(table => table.toLowerCase()));
    return removed.filter(field => inThem.has(storedIn(field).toLowerCase()));
  };
  return {
    tables,
    compare: compareOf(removed),
    check: checkOf(removed, tables),
    standingIn: changed => async db => {
      const standing: FieldDefinition[] = [];
      for (const field of removedIn(changed)) {
        const table = storedIn(field);
        const stands = usesJunctionTable(field)
          ? await tableStands(db, dialect, table)
          : await columnStands(db, dialect, table, columnOf(field.name));
        if (stands) standing.push(field);
      }
      if (standing.length > 0) await compareOf(standing)(db);
    },
    checkIn(changed) {
      const inThem = new Set(changed.map(table => table.toLowerCase()));
      const fields = removed.filter(field =>
        inThem.has(storedIn(field).toLowerCase())
      );
      if (fields.length === 0) return undefined;
      return checkOf(
        fields,
        tables.filter(table => inThem.has(table.toLowerCase()))
      );
    },
  };
}

/**
 * Whether `error` is a save's refusal over a count that changed (`deletionHoldOf`): passed through
 * as it is wherever a failure of the save's statements would be reworded, since it names the
 * fields and their new counts, and nothing of the save ran.
 */
export function isDeletionCountRefusal(error: unknown): boolean {
  return (
    NextlyError.isCode(error, "VALIDATION_ERROR") &&
    (error.logContext as { reason?: unknown } | undefined)?.reason ===
      "deletion-count-changed"
  );
}
