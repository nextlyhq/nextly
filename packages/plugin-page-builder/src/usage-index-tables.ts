/**
 * The usage indexes' rows, in the plugin's own tables.
 *
 * The rows used to live in two collections. A super-admin passes every access
 * rule a collection declares, so a row added or removed by hand changed what a
 * count said while health still called it exact, and health could not read
 * the rows in the snapshot it reads its bookkeeping from. The tables declared
 * in `schema/tables.ts` have neither problem: only this plugin's `ctx.db`
 * reaches them, and a `ctx.db` transaction reads them beside the bookkeeping.
 *
 * Everything above this module (reconciliation, the sweep, counting, host
 * lookups) still asks its questions as the column-keyed predicates
 * `UsageIndex` builds. This is the one place those predicates become queries,
 * so each index has one storage reading however many questions are asked of
 * it.
 *
 * @module usage-index-tables
 */
import { and, asc, eq, gt, inArray } from "@nextlyhq/plugin-sdk/db";
import type {
  PluginInsert,
  PluginTransaction,
  TableDefinition,
} from "@nextlyhq/plugin-sdk/schema";

import type { ClassUsageIndexStore } from "./class-usage-maintenance";
import { classUsageIndex } from "./class-usage-reconcile";
import { componentUsageIndex } from "./component-usage";
import { lastIdOf } from "./paged-walk";
import {
  classUsageRows,
  componentUsageRows,
  SCHEMA_PREFIX,
  tokenUsageRows,
} from "./schema/tables";
import { tokenUsageIndex } from "./token-usage";
import type { UsageRowReader } from "./usage-count";
import type {
  GroupedUsageReader,
  UsageIndex,
  UsageSubject,
} from "./usage-index";

/** What a query against a usage table is made through: `ctx.db`, or a transaction on it. */
export type UsageDb = Pick<
  PluginTransaction,
  "select" | "insert" | "delete" | "table"
>;

/** A column, as the query operators take it. */
type Column = Parameters<typeof asc>[0];

/** A condition, as a select's `where` takes it. */
type Condition = NonNullable<ReturnType<typeof and>>;

/** The predicates `UsageIndex` builds: each column equal to one value, or to one of several. */
type UsageWhere = Readonly<
  Record<string, { equals: string } | { in: readonly string[] }>
>;

/** One usage index's table, as the queries below reach it. */
export interface UsageTable {
  /** The table's SQL name, for messages and for the backfill's generation. */
  readonly name: string;
  /** Its columns, by the row's field names. */
  columns(db: UsageDb): Readonly<Record<string, Column>>;
  /**
   * Up to `limit` rows in id order, after the row whose id is `after` when
   * given. A keyset rather than an offset: a row deleted from a page already
   * read moves no later row back past the next page's start.
   */
  rows(
    db: UsageDb,
    where: Condition | undefined,
    limit: number,
    after: string | undefined
  ): Promise<unknown[]>;
  /** Store one row, from the values reconciliation derived. */
  insert(db: UsageDb, data: Record<string, unknown>): Promise<void>;
  /** Remove the rows a condition matches; how many. */
  remove(db: UsageDb, where: Condition): Promise<number>;
}

/** The SQL name a table definition is created under. */
const tableName = (definition: TableDefinition): string =>
  `${SCHEMA_PREFIX}__${definition.name}`;

/**
 * The parts of a table every query shares, over its definition. Insert is the
 * one each table states for itself, since only it knows its own columns.
 */
function usageTable<T extends TableDefinition>(
  definition: T,
  columns: (db: UsageDb) => Readonly<Record<string, Column>>,
  insert: (data: Record<string, unknown>) => PluginInsert<T>
): UsageTable {
  return {
    name: tableName(definition),
    columns,
    rows: (db, where, limit, after) => {
      const id = columnOf(columns(db), "id", definition.name);
      const window =
        after === undefined ? where : (and(where, gt(id, after)) ?? where);
      const select = db.select(definition);
      const filtered = window === undefined ? select : select.where(window);
      return filtered.orderBy(asc(id)).limit(limit).all();
    },
    insert: (db, data) => db.insert(definition, insert(data)),
    remove: (db, where) => db.delete(definition).where(where),
  };
}

/** A string column of a derived row, refused when it is not one. */
function text(data: Record<string, unknown>, column: string): string {
  const value = data[column];
  if (typeof value !== "string") {
    throw new Error(
      `[page-builder] a usage index row was built without a text "${column}"`
    );
  }
  return value;
}

/** The subject columns of a derived row. */
function subjectOf(data: Record<string, unknown>): UsageSubjectValues {
  return {
    scope: text(data, "scope"),
    entity: text(data, "entity"),
    entityKey: text(data, "entityKey"),
    field: text(data, "field"),
    locale: text(data, "locale"),
    variant: text(data, "variant"),
  };
}

/** The subject columns as stored: text, whatever closed set the reader checks. */
type UsageSubjectValues = Record<keyof UsageSubject, string>;

/** The class index's table. */
const CLASS_TABLE: UsageTable = usageTable(
  classUsageRows,
  db => db.table(classUsageRows),
  data => ({ ...subjectOf(data), classId: text(data, "classId") })
);

/** The component index's table. */
const COMPONENT_TABLE: UsageTable = usageTable(
  componentUsageRows,
  db => db.table(componentUsageRows),
  data => ({
    ...subjectOf(data),
    kind: text(data, "kind"),
    componentId: text(data, "componentId"),
  })
);

/** The variable index's table. */
const TOKEN_TABLE: UsageTable = usageTable(
  tokenUsageRows,
  db => db.table(tokenUsageRows),
  data => ({ ...subjectOf(data), tokenId: text(data, "tokenId") })
);

/** Which table holds each index's rows. */
const TABLES: ReadonlyMap<unknown, UsageTable> = new Map<unknown, UsageTable>([
  [classUsageIndex, CLASS_TABLE],
  [componentUsageIndex, COMPONENT_TABLE],
  [tokenUsageIndex, TOKEN_TABLE],
]);

/**
 * The table an index's rows live in. Refused for a descriptor this package
 * does not ship, rather than answered from some other table: rows read from
 * the wrong one would answer about the wrong references.
 */
export function usageTableOf<TRow extends UsageSubject>(
  index: UsageIndex<TRow>
): UsageTable {
  const table = TABLES.get(index);
  if (table === undefined) {
    throw new Error(
      "[page-builder] this usage index is not one the page builder stores"
    );
  }
  return table;
}

/** A named column, refused when the table has none by that name. */
function columnOf(
  columns: Readonly<Record<string, Column>>,
  name: string,
  table: string
): Column {
  const column = columns[name];
  if (column === undefined) {
    throw new Error(
      `[page-builder] the usage table "${table}" has no column "${name}"`
    );
  }
  return column;
}

/**
 * A predicate as a condition on one table, or `null` when it matches nothing
 * (an `in` over no values). A column the table lacks is refused rather than
 * dropped: a dropped clause widens the question, and a sweep asked the wider
 * one removes rows it was never asked about.
 */
function conditionOf(
  table: UsageTable,
  db: UsageDb,
  where: UsageWhere
): Condition | undefined | null {
  const columns = table.columns(db);
  const parts: Condition[] = [];
  for (const [name, predicate] of Object.entries(where)) {
    const column = columnOf(columns, name, table.name);
    if ("equals" in predicate) {
      parts.push(eq(column, predicate.equals));
      continue;
    }
    if (predicate.in.length === 0) return null;
    parts.push(inArray(column, [...predicate.in]));
  }
  return parts.length === 0 ? undefined : and(...parts);
}

/**
 * One page of the rows a predicate matches, after the row `after` names, and
 * whether more follow. The first page is the one with no `after`; a later page
 * asked for by number alone is refused, since only the cursor says where the
 * last page ended once rows have come and gone.
 */
async function pageOf(
  table: UsageTable,
  db: UsageDb,
  where: UsageWhere,
  at: { page: number; after?: string | undefined },
  limit: number
): Promise<{ items: unknown[]; hasNext: boolean }> {
  if (at.page > 1 && at.after === undefined) {
    throw new Error(
      `[page-builder] the usage table "${table.name}" pages by id and was asked for page ${String(at.page)} without the id the last page ended on`
    );
  }
  const condition = conditionOf(table, db, where);
  if (condition === null) return { items: [], hasNext: false };
  // One row past the page, so whether another follows is read rather than
  // guessed from a full page.
  const rows = await table.rows(db, condition, limit + 1, at.after);
  return { items: rows.slice(0, limit), hasNext: rows.length > limit };
}

/**
 * The index store reconciliation and the sweep write through, over one table.
 *
 * `db` is `ctx.db`, or the transaction a fenced write runs in, so a write the
 * fence checks lands in the same transaction as the check.
 */
function usageTableStore(db: UsageDb, table: UsageTable): ClassUsageIndexStore {
  return {
    find: async args => {
      // The cursor every caller pages by. Ordering by anything else would let
      // a write between pages move a row across the page boundary.
      if (args.sort !== "id") {
        throw new Error(
          `[page-builder] the usage index pages by id and was asked to sort by "${args.sort}"`
        );
      }
      const found = await pageOf(table, db, args.where, args, args.limit);
      return { items: found.items, meta: { hasNext: found.hasNext } };
    },
    create: args => table.insert(db, args.data),
    delete: async args => {
      const removed = await table.remove(
        db,
        eq(columnOf(table.columns(db), "id", table.name), args.id)
      );
      return { removed };
    },
  };
}

/**
 * An index store whose WRITES are fenced by a backfill run.
 *
 * Reads pass straight through. Each create and delete runs inside the
 * transaction that checks the run is still the current one, through that
 * transaction, so a pass a newer run replaced (the bounds moved, or a
 * maintenance write failed) cannot land rows derived the old way after the
 * new run has walked the document.
 */
export function fencedUsageTableStore(
  db: UsageDb,
  table: UsageTable,
  fenced: <T>(write: (tx: PluginTransaction) => Promise<T>) => Promise<T>
): ClassUsageIndexStore {
  const reads = usageTableStore(db, table);
  return {
    find: args => reads.find(args),
    create: args => fenced(tx => usageTableStore(tx, table).create(args)),
    delete: args => fenced(tx => usageTableStore(tx, table).delete(args)),
  };
}

/** Every usage index's store, as a save's maintenance writes them. */
export interface UsageIndexStores {
  classIndex: ClassUsageIndexStore;
  componentIndex: ClassUsageIndexStore;
  tokenIndex: ClassUsageIndexStore;
}

/** Every usage index's store, over its table in `db`. */
export function usageIndexStores(db: UsageDb): UsageIndexStores {
  return {
    classIndex: usageTableStore(db, usageTableOf(classUsageIndex)),
    componentIndex: usageTableStore(db, usageTableOf(componentUsageIndex)),
    tokenIndex: usageTableStore(db, usageTableOf(tokenUsageIndex)),
  };
}

/** Remove every row of one table a predicate matches; how many. */
export async function forgetUsageRows(
  db: UsageDb,
  table: UsageTable,
  where: UsageWhere
): Promise<number> {
  const condition = conditionOf(table, db, where);
  // No predicate is no question: refused rather than read as "every row".
  if (condition === null || condition === undefined) return 0;
  return table.remove(db, condition);
}

/** How many rows one page of a batch read takes. */
const ROWS_PER_PAGE = 500;

/** The rows of one index a predicate matches, a page at a time. */
export function usageTableRows(
  db: UsageDb,
  table: UsageTable,
  /** Rows per page; smaller only in a test. */
  pageSize: number = ROWS_PER_PAGE
): UsageRowReader {
  return args => pageOf(table, db, args.where, args, pageSize);
}

/**
 * How many rows one grouped read takes before calling its answer cut short. A
 * row is a (document, field, language, form), so this is thousands of
 * documents: far past what one screen shows, and a bound on what one count
 * costs.
 */
const MOST_GROUPED_ROWS = 10_000;

/**
 * The distinct values of one column among the rows a predicate matches, read
 * a page at a time. `truncated` says the rows ran past the bound, so the
 * values are some of them, which a count reads as a floor.
 */
export function usageTableGroups(
  db: UsageDb,
  table: UsageTable
): GroupedUsageReader {
  return async args => {
    const buckets = new Set<string | null>();
    let after: string | undefined;
    for (let page = 1; ; page += 1) {
      const found = await pageOf(
        table,
        db,
        args.where,
        { page, after },
        ROWS_PER_PAGE
      );
      after = lastIdOf(found.items);
      for (const row of found.items) {
        const value = (row as Record<string, unknown>)[args.groupBy];
        buckets.add(typeof value === "string" ? value : null);
      }
      if (!found.hasNext) return { buckets: [...buckets], truncated: false };
      if (page * ROWS_PER_PAGE >= MOST_GROUPED_ROWS) {
        return { buckets: [...buckets], truncated: true };
      }
    }
  };
}

/**
 * Whether any document in an index could not be read whole: one row of its
 * marker is enough. Read through `db`, so health asks it inside the snapshot
 * it reads the bookkeeping from.
 */
export async function anyUndetermined<TRow extends UsageSubject>(
  db: UsageDb,
  index: UsageIndex<TRow>
): Promise<boolean> {
  const found = await pageOf(
    usageTableOf(index),
    db,
    index.whereUndetermined(),
    { page: 1 },
    1
  );
  return found.items.length > 0;
}
