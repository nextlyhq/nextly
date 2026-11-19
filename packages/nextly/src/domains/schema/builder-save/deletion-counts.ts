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
 * statements commit on their own, no transaction holds the count and the drop together: the count
 * is taken just before the statements, compared the same way, and other writes are not held. A
 * save applied by a push rather than its file (a translated collection in development, or an app
 * with no file writer) is compared the same way, just before the push, with nothing held.
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
import {
  countNulls as countNullsHelper,
  countRows as countRowsHelper,
  countRowsBreakingNotNull,
} from "../pipeline/classifier/count-helpers";
import { quoteIdent } from "../pipeline/sql-templates/identifier-quoting";
import {
  fieldProducesColumn,
  junctionTableNameFor,
  toSnakeCase,
} from "../services/field-column-descriptor";

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
 * The table a removed field's values are stored in: the entity's translations table for a
 * translated field of a translated entity, its own table for every other field.
 */
function valuesTableOf(
  tableName: string,
  localized: boolean,
  field: FieldDefinition
): string {
  return isFieldLocalized(field, localized)
    ? `${tableName}${STORAGE_FORMAT.companionSuffix}`
    : tableName;
}

/**
 * Count each removed field's non-null values where they are stored:
 * - a field with no storage (a virtual field) holds nothing;
 * - a field whose values live in a table of their own (a field group, a
 *   many-to-many relationship) is not counted here, so its count is unknown;
 * - a translated field of a translated entity is counted in the companion
 *   table, across its languages; every other field on the main table;
 * - the column is the field's stored column name, not its name as written.
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
  // One row count per table, shared by the fields stored in it.
  const totals = new Map<string, Promise<number>>();
  const totalOf = (table: string): Promise<number> => {
    const known = totals.get(table);
    if (known) return known;
    const pending = countRowsHelper(db, dialect, table);
    totals.set(table, pending);
    return pending;
  };

  for (const field of removed) {
    if (isVirtualField(field)) {
      counts[field.name] = { rowCount: 0, unknown: false };
      continue;
    }
    if (!fieldProducesColumn(field)) {
      counts[field.name] = UNCOUNTED;
      continue;
    }
    const table = valuesTableOf(tableName, localized, field);
    try {
      const total = await totalOf(table);
      const nulls = await countNullsHelper(
        db,
        dialect,
        table,
        toSnakeCase(field.name)
      );
      counts[field.name] = {
        rowCount: Math.max(0, total - nulls),
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
 */
export function deletionHoldOf(args: {
  dialect: SupportedDialect;
  tableName: string;
  /** Whether the entity is translated before the save, which decides where its values are. */
  localized: boolean;
  previous: readonly FieldDefinition[];
  next: readonly FieldDefinition[];
  confirmed: readonly ConfirmedDeletion[] | undefined;
}): DeletionHold | undefined {
  const { dialect, tableName, localized, confirmed } = args;
  if (confirmed === undefined) return undefined;
  const kept = new Set(args.next.map(field => field.name));
  const removed = args.previous.filter(
    field =>
      !kept.has(field.name) &&
      !isVirtualField(field) &&
      fieldProducesColumn(field)
  );
  if (removed.length === 0) return undefined;
  const tables = [
    ...new Set(
      removed.map(field => valuesTableOf(tableName, localized, field))
    ),
  ];
  const confirmedOf = new Map(
    confirmed.map(entry => [entry.field, entry.count])
  );
  const compare = async (db: unknown): Promise<void> => {
    const counts = await computeNonNullCounts(
      db,
      dialect,
      tableName,
      localized,
      removed
    );
    const changed = removed.flatMap(field => {
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
  return {
    tables,
    compare,
    async check(db) {
      if (dialect === "postgresql") {
        // Other sessions' writes to the tables wait from here until the save's transaction ends;
        // their reads go on. A held table ends the try under the try's own lock timeout.
        for (const table of tables) {
          await (db as Executes).execute(
            sql.raw(
              `LOCK TABLE ${quoteIdent(table, dialect)} IN SHARE ROW EXCLUSIVE MODE`
            )
          );
        }
      }
      await compare(db);
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
