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
 * Component tables are discovered from the live catalog rather than the registry, so the
 * sweep still works when a component's registry row was already removed.
 *
 * @module domains/components/services/teardown-entity-component-data
 */

import type {
  SupportedDialect,
  WhereClause,
} from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../../errors";
import { q } from "../../i18n/migration/ddl-types";
import { isCompanionTable } from "../../schema/pipeline/managed-tables";

/** Bound on how deep component nesting is followed; mirrors MAX_COMPONENT_NESTING_DEPTH. */
const DEFAULT_MAX_DEPTH = 10;

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
  /** Override the nesting bound; primarily for tests. */
  maxDepth?: number;
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
 * Fails when an unaddressable component table still holds rows for `parentTable`.
 *
 * Counted with a parameterised statement rather than the query builder because the ORM
 * cannot address this table — that is the condition being handled. Reads only; the rows
 * are never deleted this way.
 */
async function assertNoRowsForParent(
  adapter: TeardownComponentDataAdapter,
  componentTable: string,
  parentTable: string
): Promise<void> {
  const quoted = q(componentTable, adapter.dialect);
  const parentColumn = q("_parent_table", adapter.dialect);
  const placeholder = adapter.dialect === "postgresql" ? "$1" : "?";

  let rows: Array<Record<string, unknown>>;
  try {
    rows = await adapter.executeQuery<Record<string, unknown>>(
      `SELECT COUNT(*) AS n FROM ${quoted} WHERE ${parentColumn} = ${placeholder}`,
      [parentTable]
    );
  } catch (error) {
    // No `_parent_table` column means the table does not hold component instances at all,
    // despite the `comp_` prefix, so it cannot own rows for this entity. Any other failure
    // leaves the question unanswered and must not be read as "empty".
    if (/_parent_table/.test(String(error))) return;
    throw error;
  }

  const count = Number(rows[0]?.n ?? 0);
  if (count === 0) return;

  throw NextlyError.internal({
    logContext: {
      reason: "component-table-unresolvable-with-rows",
      componentTable,
      parentTable,
      rows: count,
    },
  });
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
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
  const { adapter, parentTable, maxDepth = DEFAULT_MAX_DEPTH } = args;

  // Component data tables only: `comp_` prefixed, excluding their `_locales` companions
  // (those are reached through their owning instance, never scanned as parents).
  const componentTables = (await adapter.listTables()).filter(
    name => name.startsWith("comp_") && !isCompanionTable(name)
  );

  if (componentTables.length === 0) {
    return { instancesDeleted: 0, tablesTouched: [], skippedTables: [] };
  }

  const tablesTouched = new Set<string>();
  const skippedTables = new Set<string>();
  let instancesDeleted = 0;
  // The entity's own table owns every instance pointing at it, hence `ids: null`.
  let frontier: Frontier[] = [{ table: parentTable, ids: null }];
  let depth = 0;

  while (frontier.length > 0 && depth < maxDepth) {
    const nextFrontier: Frontier[] = [];

    for (const componentTable of componentTables) {
      // Resolvability is a property of the table, not of any one query, so establish it
      // once per table. Checking here also means an unresolvable table is skipped for
      // every parent rather than re-attempted on each iteration.
      if (skippedTables.has(componentTable)) continue;
      if (!(await isResolvable(adapter, componentTable))) {
        // Skipping is only safe when the table holds nothing for this entity. If it does,
        // the caller would drop the parent table and strand those rows while reporting a
        // successful delete, so the delete fails instead and names the table.
        await assertNoRowsForParent(adapter, componentTable, parentTable);
        skippedTables.add(componentTable);
        continue;
      }

      for (const parent of frontier) {
        // Match on parent id as well as parent table for nested levels — without it the
        // sweep would take instances belonging to other entities using the same component.
        const idGroups =
          parent.ids === null ? [null] : chunk(parent.ids, ID_CHUNK_SIZE);

        for (const ids of idGroups) {
          if (ids !== null && ids.length === 0) continue;

          const where: WhereClause = {
            and: [
              { column: "_parent_table", op: "=", value: parent.table },
              ...(ids === null
                ? []
                : [{ column: "_parent_id", op: "IN" as const, value: ids }]),
            ],
          };

          // Read the ids first: they are needed to reach nested instances and companion
          // rows, and the DELETE cannot return them portably across dialects. Errors here
          // propagate — the table resolves, so a failure is a real database problem and
          // must not be mistaken for "nothing to clean up".
          const rows = await adapter.select<{ id: string }>(componentTable, {
            where,
          });
          if (rows.length === 0) continue;

          const instanceIds = rows
            .map(r => r.id)
            .filter((id): id is string => typeof id === "string");

          await adapter.delete(componentTable, where);
          instancesDeleted += rows.length;
          tablesTouched.add(componentTable);

          // Localized components keep translations keyed by the instance id.
          const companion = `${componentTable}_locales`;
          if (
            instanceIds.length > 0 &&
            (await adapter.tableExists(companion))
          ) {
            for (const idChunk of chunk(instanceIds, ID_CHUNK_SIZE)) {
              await adapter.delete(companion, {
                and: [{ column: "_parent", op: "IN", value: idChunk }],
              });
            }
          }

          if (instanceIds.length > 0) {
            nextFrontier.push({ table: componentTable, ids: instanceIds });
          }
        }
      }
    }

    frontier = nextFrontier;
    depth += 1;
  }

  return {
    instancesDeleted,
    tablesTouched: [...tablesTouched],
    skippedTables: [...skippedTables],
  };
}
