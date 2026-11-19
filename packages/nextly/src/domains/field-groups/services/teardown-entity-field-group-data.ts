/**
 * Remove the embedded component rows an entity leaves behind when it is DELETED.
 *
 * Component values do not live on the parent row — `field-column-descriptor` maps a
 * `component` field to `"skip"`, so `dc_<slug>` / `single_<slug>` gets no column for it.
 * The values are rows in the component's own `comp_<slug>` table, associated back to the
 * parent by three plain string columns (`_parent_id`, `_parent_table`, `_parent_field`)
 * with NO foreign key. Nothing therefore cascades: dropping the parent table leaves every
 * embedded instance behind, pointing at a table that no longer exists.
 *
 * `deleteComponentData` covers a single entry; this is the ENTITY-level counterpart, used
 * when the whole collection/single/component goes away.
 *
 * Three things make this more than a single DELETE:
 *   - Components nest. A component instance can itself be the parent of another instance
 *     (`_parent_table` = `comp_<outer>`), so the sweep walks down level by level.
 *   - Nested instances must be matched by parent id, not just parent table, or the sweep
 *     would delete instances belonging to OTHER entities that share the same component.
 *   - A localized component keeps its translations in `comp_<slug>_locales`, keyed by the
 *     instance id, so those rows have to go with their instance.
 *
 * Component tables are discovered from the live catalog UNION the registry: the catalog
 * covers `comp_`-prefixed tables whose registry row was already removed, and the registry
 * covers registered components whose table has not been materialized yet.
 *
 * @module domains/field-groups/services/teardown-entity-field-group-data
 */

import type {
  SupportedDialect,
  WhereClause,
} from "@nextlyhq/adapter-drizzle/types";
import { sql } from "drizzle-orm";

import { NextlyError } from "../../../errors";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import { q } from "../../i18n/migration/ddl-types";
import { querySqlRows } from "../../schema/pipeline/classifier/count-helpers";
import { isCompanionTable } from "../../schema/pipeline/managed-tables";
import { readIdentifierCaseRules } from "../../schema/utils/read-identifier-case";
import {
  indexCatalog,
  resolveCatalogName,
} from "../../schema/utils/resolve-catalog-name";
import { MIGRATION_TARGET } from "../migration/manifest";
import { resolveRegistryTableName } from "../storage/resolve-storage-names";

/**
 * Registry table holding one row per component, including its physical table
 * name. Resolved rather than constant: the field-group storage migration
 * renames it, so which of the two names a database holds is an observation.
 */
async function registryTableName(
  adapter: TeardownComponentDataAdapter
): Promise<string> {
  return resolveRegistryTableName(adapter);
}

/**
 * Chunk size for `IN (...)` lists. Keeps a very large entity from exceeding a driver's
 * bind-parameter limit (Postgres caps at 65535).
 */
const ID_CHUNK_SIZE = 500;

/** Minimal adapter surface this helper needs — matches DrizzleAdapter. */
export interface TeardownComponentDataAdapter {
  dialect: SupportedDialect;
  select<T = Record<string, unknown>>(
    table: string,
    options: { where?: WhereClause }
  ): Promise<T[]>;
  delete(table: string, where: WhereClause): Promise<number>;
  executeQuery<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  getDrizzle<T = unknown>(): T;
  tableExists(tableName: string): Promise<boolean>;
  listTables(): Promise<string[]>;
}

export interface TeardownEntityComponentDataArgs {
  adapter: TeardownComponentDataAdapter;
  /**
   * Physical MAIN table of the entity being deleted (`dc_posts`, `single_home`). Every
   * component instance whose `_parent_table` is this table belongs to the entity.
   */
  parentTable: string;
}

export interface TeardownEntityComponentDataResult {
  /** Component instance rows deleted, across all tables and nesting levels. */
  instancesDeleted: number;
  /** Component tables that actually had rows removed. */
  tablesTouched: string[];
  /**
   * Component tables the ORM could not address, each verified to hold no rows for this
   * entity before being skipped. A table that cannot be addressed AND holds rows fails the
   * delete instead of appearing here.
   */
  skippedTables: string[];
}

/** One level of the walk: instances in `table` whose ids are `ids` (null = every row). */
interface Frontier {
  table: string;
  ids: string[] | null;
}

/**
 * Whether the ORM has a schema registered for `table`, so `select`/`delete` can address it.
 *
 * A `comp_` table can exist in the catalog with no registered schema — left over from a
 * component deleted in an earlier process, or created before a boot that never re-registered
 * it. Those must be skipped rather than abort the delete. Every OTHER failure (connection
 * loss, permissions, lock timeout) is rethrown: treating it as "no schema, nothing to clean"
 * would report a successful delete while the rows survive.
 */
async function isResolvable(
  adapter: TeardownComponentDataAdapter,
  table: string
): Promise<boolean> {
  try {
    // A no-op probe: matches nothing, so it costs a plan and no rows, and fails only on
    // schema resolution or a genuine database error.
    await adapter.select(table, {
      where: { and: [{ column: "id", op: "IS NULL" }] },
    });
    return true;
  } catch (error) {
    // The adapter reports an unregistered table by message; there is no distinct code for
    // it. Anything else is a real failure and belongs to the caller.
    if (/not found in schema registry/i.test(String(error))) return false;
    throw error;
  }
}

/**
 * Fails when an unaddressable component table holds rows owned by `parent`.
 *
 * Checked against ONE frontier entry, so it must be called for every level of the walk:
 * an unaddressable table can hold nested instances whose `_parent_table` is another
 * component table rather than the entity's own, and those are only visible once that
 * level's instance ids are known.
 *
 * Counted with a parameterised statement rather than the query builder because the ORM
 * cannot address this table — that is the condition being handled. Reads only; the rows
 * are never deleted this way.
 */
async function assertNoRowsForFrontier(
  adapter: TeardownComponentDataAdapter,
  componentTable: string,
  parent: Frontier,
  instanceTables: InstanceTables
): Promise<void> {
  const count = await countRowsUnder(
    adapter,
    componentTable,
    parent,
    instanceTables
  );
  if (count === 0) return;

  throw NextlyError.internal({
    logContext: {
      reason: "component-table-unresolvable-with-rows",
      componentTable,
      parentTable: parent.table,
      rows: count,
    },
  });
}

/**
 * How many rows of `componentTable` the frontier entry owns; none for a table without a
 * `_parent_table` column (not among `instanceTables`), which holds no component instances
 * whatever its prefix.
 */
async function countRowsUnder(
  adapter: TeardownComponentDataAdapter,
  componentTable: string,
  parent: Frontier,
  instanceTables: InstanceTables
): Promise<number> {
  // `ids: null` means every row under this parent table belongs to the entity; otherwise
  // only the instances deleted at the previous level own the rows below them.
  if (parent.ids !== null && parent.ids.length === 0) return 0;

  // No `_parent_table` column means the table does not hold component instances at all, despite
  // its prefix, so it cannot own rows for this entity. Asked of the catalog, through the adapter
  // the teardown runs on, rather than by catching the count's failure: on PostgreSQL a failed
  // statement aborts the delete's transaction, and every statement after it fails.
  if (!(await instanceTables()).has(componentTable)) return 0;

  const pg = adapter.dialect === "postgresql";
  const quoted = q(componentTable, adapter.dialect);
  const parentTableColumn = q(
    STORAGE_FORMAT.columns.parentTable,
    adapter.dialect
  );
  const parentIdColumn = q(STORAGE_FORMAT.columns.parentId, adapter.dialect);

  const params: unknown[] = [parent.table];
  let where = `${parentTableColumn} = ${pg ? "$1" : "?"}`;
  if (parent.ids !== null) {
    const placeholders = parent.ids
      .map((_, i) => (pg ? `$${i + 2}` : "?"))
      .join(", ");
    where += ` AND ${parentIdColumn} IN (${placeholders})`;
    params.push(...parent.ids);
  }

  // Any failure leaves the question unanswered and must not be read as "empty".
  const rows = await adapter.executeQuery<Record<string, unknown>>(
    `SELECT COUNT(*) AS n FROM ${quoted} WHERE ${where}`,
    params
  );

  return Number(rows[0]?.n ?? 0);
}

/** The candidate tables, as the catalog spells them, that have a `_parent_table` column. */
type InstanceTables = () => Promise<ReadonlySet<string>>;

/**
 * Which of `tables` have a `_parent_table` column, read from the catalog in one query through
 * `adapter`'s own connection (the delete's transaction, where it runs in one), on the first ask
 * and kept for the rest of the walk or count. A table the catalog does not list has none.
 *
 * Each table and column is compared as its server compares it (`readIdentifierCaseRules`), as the
 * discovery of these tables compares them: a server that holds `comp_Hero` and `comp_hero` as two
 * tables keeps them two here, and one that keeps `_PARENT_TABLE` a column of its own does not
 * take it for the parent column, which the count names exactly.
 */
function instanceTablesOf(
  adapter: TeardownComponentDataAdapter,
  tables: readonly string[]
): InstanceTables {
  let read: Promise<ReadonlySet<string>> | undefined;
  return () => {
    read ??= (async () => {
      // Loaded on demand: the introspection reaches the schema pipeline, which this teardown
      // otherwise does not.
      const { introspectLiveColumns } = await import(
        "../../schema/pipeline/diff/introspect-live"
      );
      const [rules, snapshot] = await Promise.all([
        readIdentifierCaseRules(adapter),
        introspectLiveColumns(adapter.getDrizzle(), adapter.dialect, [
          ...tables,
        ]),
      ]);
      const listed = indexCatalog(
        snapshot.tables.map(table => table.name),
        rules.tables
      );
      const columnsOf = new Map(
        snapshot.tables.map(table => [
          table.name,
          indexCatalog(
            table.columns.map(column => column.name),
            rules.columns
          ),
        ])
      );
      return new Set(
        tables.filter(table => {
          const name = resolveCatalogName(listed, table);
          const columns = name === undefined ? undefined : columnsOf.get(name);
          return (
            columns !== undefined &&
            resolveCatalogName(columns, STORAGE_FORMAT.columns.parentTable) !==
              undefined
          );
        })
      );
    })();
    return read;
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Physical table names recorded in the component registry.
 *
 * Read through the registry rather than inferred from a prefix so a row still
 * pointing at a non-derived table is visited too. Returns an empty list when the
 * registry table is absent (a database that predates it, or a teardown running
 * before system tables exist), leaving prefix discovery as the only source.
 */
async function listRegisteredComponentTables(
  adapter: TeardownComponentDataAdapter,
  discovered: string[]
): Promise<string[]> {
  // Exact-first, then case-insensitive only where the server folds. Deleting
  // rows from a table resolved by folding a name the server treats as distinct
  // would delete another table's rows, so the comparison rules come from the
  // server rather than being assumed. The reasoning lives with the resolver.
  //
  // Built before the registry itself is looked up, so the registry is found by
  // the same rules as the tables it names. Gating on an exact match while
  // resolving its rows case-insensitively would skip registry discovery on a
  // server that reports the registry in another case, and every custom-named
  // component would then be left out of the sweep.
  const catalog = indexCatalog(
    discovered,
    (await readIdentifierCaseRules(adapter)).tables
  );
  // Two different questions, deliberately answered with two different names.
  //
  // *Which catalog entry is the registry* is physical identity, so it is resolved
  // through the server's comparison rules and the answer is the spelling the
  // catalog reports. That spelling is what the metadata exclusion below needs.
  const declared = await registryTableName(adapter);
  const registryTable = resolveCatalogName(catalog, declared);
  if (registryTable === undefined) return [];

  // *How to address the registry through the ORM* is a different question with a
  // different answer: the schema registry keys static schemas by the name the
  // Drizzle table declares and looks them up exactly, so it only ever knows the
  // canonical name. Addressing it by the catalog's spelling would be reported as
  // unregistered on a folding server, and this function would return nothing —
  // silently dropping every custom-named component from the sweep.
  //
  // Consulted only when the ORM can address it. An executor with no schema
  // registered for the registry — a hand-built adapter carrying just its own
  // tables — has no schema for any component table either, so it could not
  // address a custom-named one even if this read returned it; prefix discovery
  // stays complete for everything such an executor can reach. Probing rather
  // than catching keeps genuine read failures propagating instead of being
  // mistaken for "nothing registered".
  if (!(await isResolvable(adapter, declared))) return [];

  const rows = await adapter.select<Record<string, unknown>>(declared, {});

  return (
    rows
      .map(row => row.table_name ?? row.tableName)
      .filter((name): name is string => typeof name === "string" && name !== "")
      // A registry row can name a table that was never created — a component
      // whose migration is pending or failed. Probing one raises a missing-table
      // error, and because this sweep precedes every entity delete, a single
      // unmaterialized component would block all of them.
      .map(name => resolveCatalogName(catalog, name))
      .filter((name): name is string => name !== undefined)
      // The registry is metadata, never component storage. A malformed row
      // pointing back at it resolves to whatever spelling the catalog reports,
      // so excluding it here — where that spelling is known — is what keeps it
      // out; a caller comparing against the constant alone would miss a
      // case-different spelling and probe the registry as an instance table.
      .filter(name => name !== registryTable)
  );
}

/**
 * Every table that can hold component rows: `comp_` and `fg_` prefixed ones, and every table the
 * registry names, without the registry itself or any translations table.
 */
async function componentTablesOf(
  adapter: TeardownComponentDataAdapter
): Promise<string[]> {
  // Component data tables: `comp_` prefixed by convention, plus every table the
  // registry has registered — a row written before names resolved canonically can
  // point at a table carrying no prefix, so prefix discovery alone would leave its
  // rows orphaned with `_parent_table` pointing at the deleted entity. Companions
  // are excluded either way (they are reached through their owning instance, never
  // scanned as parents).
  const discovered = await adapter.listTables();
  const registered = await listRegisteredComponentTables(adapter, discovered);
  const registry = await registryTableName(adapter);
  return [
    ...new Set([
      // Both prefixes. The registry-derived list below cannot recover a table
      // whose metadata row is exactly what went missing, so prefix discovery is
      // the only route to an orphan — and after the storage migration a
      // generated table carries `fg_`, not `comp_`.
      ...discovered.filter(
        name =>
          name.startsWith(STORAGE_FORMAT.tablePrefix) ||
          name.startsWith(MIGRATION_TARGET.tablePrefix)
      ),
      ...registered,
    ]),
    // The registry itself is metadata, never component storage. A row pointing
    // at it would otherwise be probed as an instance table, where a missing
    // `_parent_table` column breaks the delete and a permissive adapter could
    // damage the metadata.
  ].filter(name => name !== registry && !isCompanionTable(name));
}

/**
 * The component rows an entity's table owns directly, for each component table holding any: what a
 * create over a leftover entity table counts as that table's content (`clearLeftoverStorage`), so
 * it is refused rather than taken by this teardown. Reads only.
 */
export async function countEntityComponentRows(args: {
  adapter: TeardownComponentDataAdapter;
  parentTable: string;
}): Promise<{ table: string; rows: number }[]> {
  const owned: { table: string; rows: number }[] = [];
  const tables = await componentTablesOf(args.adapter);
  // One catalog read for every table counted.
  const instanceTables = instanceTablesOf(args.adapter, tables);
  for (const table of tables) {
    const rows = await countRowsUnder(
      args.adapter,
      table,
      {
        table: args.parentTable,
        ids: null,
      },
      instanceTables
    );
    if (rows > 0) owned.push({ table, rows });
  }
  return owned;
}

/**
 * Deletes every component instance owned by `parentTable`, following nesting, and the
 * matching `comp_<slug>_locales` rows.
 *
 * Call this BEFORE dropping the entity's main table — it reads nothing from that table,
 * but running first keeps the entity intact if the sweep fails.
 */

export async function teardownEntityComponentData(
  args: TeardownEntityComponentDataArgs
): Promise<TeardownEntityComponentDataResult> {
  const { adapter, parentTable } = args;

  const componentTables = await componentTablesOf(adapter);

  if (componentTables.length === 0) {
    return { instancesDeleted: 0, tablesTouched: [], skippedTables: [] };
  }
  // Read from the catalog once, the first time a table the ORM cannot address is checked, for
  // every table of the walk.
  const instanceTables = instanceTablesOf(adapter, componentTables);

  const tablesTouched = new Set<string>();
  let instancesDeleted = 0;
  const { skippedTables } = await walkEntityComponentRows(
    adapter,
    componentTables,
    instanceTables,
    parentTable,
    async ({ table, where, rows, instanceIds }) => {
      await adapter.delete(table, where);
      instancesDeleted += rows;
      tablesTouched.add(table);
      // Localized components keep translations keyed by the instance id.
      const companion = `${table}${STORAGE_FORMAT.companionSuffix}`;
      if (instanceIds.length > 0 && (await adapter.tableExists(companion))) {
        for (const idChunk of chunk(instanceIds, ID_CHUNK_SIZE)) {
          await adapter.delete(companion, {
            and: [{ column: "_parent", op: "IN", value: idChunk }],
          });
        }
      }
    }
  );

  return {
    instancesDeleted,
    tablesTouched: [...tablesTouched],
    skippedTables,
  };
}

/**
 * How many rows the teardown of `parentTable`'s component data removes from each table: every
 * instance it reaches, at every level of nesting, and their translations. Reads only, through
 * the walk the teardown takes (`walkEntityComponentRows`), so the count is of what a delete
 * removes, never a second reading of it. A table it would refuse to skip refuses here too.
 */
export async function countEntityComponentTree(args: {
  adapter: TeardownComponentDataAdapter;
  parentTable: string;
}): Promise<{ table: string; rows: number }[]> {
  const { adapter } = args;
  const componentTables = await componentTablesOf(adapter);
  if (componentTables.length === 0) return [];
  // One catalog read for every table the walk checks, as the teardown takes.
  const instanceTables = instanceTablesOf(adapter, componentTables);
  const counts = new Map<string, number>();
  const add = (table: string, rows: number) => {
    if (rows > 0) counts.set(table, (counts.get(table) ?? 0) + rows);
  };
  await walkEntityComponentRows(
    adapter,
    componentTables,
    instanceTables,
    args.parentTable,
    async ({ table, rows, instanceIds }) => {
      add(table, rows);
      const companion = `${table}${STORAGE_FORMAT.companionSuffix}`;
      if (instanceIds.length === 0 || !(await adapter.tableExists(companion))) {
        return;
      }
      // Through Drizzle's tagged SQL, which quotes the names and binds the ids for the dialect.
      for (const idChunk of chunk(instanceIds, ID_CHUNK_SIZE)) {
        const [row] = await querySqlRows<{ n: unknown }>(
          adapter.getDrizzle(),
          adapter.dialect,
          sql`SELECT COUNT(*) AS ${sql.identifier("n")} FROM ${sql.identifier(companion)} WHERE ${sql.identifier("_parent")} IN (${sql.join(
            idChunk.map(id => sql`${id}`),
            sql`, `
          )})`
        );
        add(companion, Number(row?.n ?? 0));
      }
    }
  );
  return [...counts].map(([table, rows]) => ({ table, rows }));
}

/** One parent's instances in one component table, as the walk reaches them. */
interface ReachedInstances {
  table: string;
  /** Selects exactly these instances: by parent table, and by parent id below the entity. */
  where: WhereClause;
  /** How many rows the read found. */
  rows: number;
  instanceIds: string[];
}

/** What the walk keeps from one level to the next. */
interface WalkState {
  adapter: TeardownComponentDataAdapter;
  componentTables: readonly string[];
  /** Which component tables hold instances: a table with no `_parent_table` column holds none. */
  instanceTables: InstanceTables;
  visit: (reached: ReachedInstances) => Promise<void>;
  /**
   * Whether each table can be addressed through the ORM. Resolvability is a property of the
   * table, so it is established once, either way; whether an unresolvable table is SAFE to skip
   * depends on the frontier and is re-checked at every level.
   */
  resolvable: Map<string, boolean>;
  skippedTables: Set<string>;
  /** The ids each table has handed on to the next level, so each instance is followed once. */
  reached: Map<string, Set<string>>;
}

/**
 * The walk the teardown and its count share: every instance `parentTable` owns, level by level,
 * handed to `visit` once per parent and table, before the next level is read. Each instance is
 * followed once: an id already reached in a table is not reached again, so the walk ends.
 */
async function walkEntityComponentRows(
  adapter: TeardownComponentDataAdapter,
  componentTables: readonly string[],
  instanceTables: InstanceTables,
  parentTable: string,
  visit: (reached: ReachedInstances) => Promise<void>
): Promise<{ skippedTables: string[] }> {
  const state: WalkState = {
    adapter,
    componentTables,
    instanceTables,
    visit,
    resolvable: new Map(),
    skippedTables: new Set(),
    reached: new Map(),
  };
  // The entity's own table owns every instance pointing at it, hence `ids: null`. Field groups
  // nest to any depth, so the walk goes down until a level finds nothing.
  let frontier: Frontier[] = [{ table: parentTable, ids: null }];
  while (frontier.length > 0) frontier = await walkLevel(state, frontier);
  return { skippedTables: [...state.skippedTables] };
}

/**
 * One level of the walk: every component table, under each parent of `frontier`, and the next
 * level, the instances found here that are not yet followed.
 *
 * Every component table, at every level: a row's parent is where it was written, which a
 * definition as it stands now cannot vouch for — one that has since stopped placing a field group
 * leaves that field group's rows stored beneath its own. Each read is a lookup on the parent
 * index.
 */
async function walkLevel(
  state: WalkState,
  frontier: readonly Frontier[]
): Promise<Frontier[]> {
  const next: Frontier[] = [];
  for (const table of state.componentTables) {
    if (!(await addressable(state, table, frontier))) continue;
    for (const parent of frontier) {
      next.push(...(await walkParent(state, table, parent)));
    }
  }
  return next;
}

/**
 * Whether `table` can be read through the ORM at this level. One that cannot is skipped only
 * when it holds nothing owned by THIS level: an unaddressable table can hold nested instances
 * parented to another component table, which only become visible once that level's ids are
 * known, so every level is checked, not just the entity's own table. Any rows found fail the
 * walk, since a delete would otherwise drop the parent and strand them.
 */
async function addressable(
  state: WalkState,
  table: string,
  frontier: readonly Frontier[]
): Promise<boolean> {
  let resolvable = state.resolvable.get(table);
  if (resolvable === undefined) {
    resolvable = await isResolvable(state.adapter, table);
    state.resolvable.set(table, resolvable);
  }
  if (resolvable) return true;
  for (const parent of frontier) {
    await assertNoRowsForFrontier(
      state.adapter,
      table,
      parent,
      state.instanceTables
    );
  }
  state.skippedTables.add(table);
  return false;
}

/**
 * The instances of `table` under one parent, read in chunks of the parent's ids below the
 * entity, and what the next level follows from them. Matching on parent id as well as parent
 * table for nested levels keeps instances belonging to other entities that use the same
 * component out of the walk.
 */
async function walkParent(
  state: WalkState,
  table: string,
  parent: Frontier
): Promise<Frontier[]> {
  const groups =
    parent.ids === null ? [null] : chunk(parent.ids, ID_CHUNK_SIZE);
  const next: Frontier[] = [];
  for (const ids of groups) {
    const followed = await walkGroup(state, table, parent.table, ids);
    if (followed !== undefined) next.push(followed);
  }
  return next;
}

/**
 * One read of `table` under `parentTable` (and, below the entity, under `ids`): the instances
 * found are handed to the visit, and those not yet followed are the next level's entry.
 */
async function walkGroup(
  state: WalkState,
  table: string,
  parentTable: string,
  ids: string[] | null
): Promise<Frontier | undefined> {
  if (ids !== null && ids.length === 0) return undefined;
  const where = parentWhere(parentTable, ids);
  // Read the ids first: they are needed to reach nested instances and companion rows, and the
  // DELETE cannot return them portably across dialects. Errors here propagate — the table
  // resolves, so a failure is a real database problem and must not be mistaken for "nothing to
  // clean up".
  const rows = await state.adapter.select<{ id: string }>(table, { where });
  if (rows.length === 0) return undefined;
  const instanceIds = rows
    .map(r => r.id)
    .filter((id): id is string => typeof id === "string");
  await state.visit({ table, where, rows: rows.length, instanceIds });
  return followOnce(state.reached, table, instanceIds);
}

/** The instances under `parentTable`, and under the parent ids `ids` where the walk has them. */
function parentWhere(parentTable: string, ids: string[] | null): WhereClause {
  return {
    and: [
      {
        column: STORAGE_FORMAT.columns.parentTable,
        op: "=",
        value: parentTable,
      },
      ...(ids === null
        ? []
        : [
            {
              column: STORAGE_FORMAT.columns.parentId,
              op: "IN" as const,
              value: ids,
            },
          ]),
    ],
  };
}

/**
 * The next level's entry for `table`: the ids of `instanceIds` not followed from it before,
 * each marked followed. None when every one was, which is how a walk over a cycle of rows ends.
 */
function followOnce(
  reached: Map<string, Set<string>>,
  table: string,
  instanceIds: readonly string[]
): Frontier | undefined {
  const seen = reached.get(table) ?? new Set<string>();
  reached.set(table, seen);
  const fresh = instanceIds.filter(id => !seen.has(id));
  for (const id of fresh) seen.add(id);
  return fresh.length > 0 ? { table, ids: fresh } : undefined;
}
