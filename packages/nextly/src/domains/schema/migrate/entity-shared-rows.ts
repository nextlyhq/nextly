/**
 * What a run that drops a collection's or Single's main table also takes of
 * it from tables every entity shares, listed before the consent is asked.
 *
 * Deleting an entity removes its rows from each shared table: its field-group
 * values, its archived translations, its history rows (autosaves, version pins
 * and readers' "seen" markers), its readers' dashboard pins, the record of the
 * media its documents use, and its documents' review state where workflows
 * keep one. Each is listed as that entity's rows in that table, belonging to
 * its main table, so a consent naming the main table covers them and naming
 * the shared table still covers every deletion in it. The record of content
 * events is not among them: a deletion leaves those events in place.
 *
 * A run reads the entities from the registry (`readCoveredEntities`), and
 * lists, in the file that drops an entity's main table, one entry for each
 * kind of shared row (`entityRowsOf`). Where the database can be read the
 * entries are counted (`countEntityRows`): a table without the entity's rows,
 * or absent, is left out, and one that cannot be counted is listed without a
 * count rather than failing the run.
 *
 * @module domains/schema/migrate/entity-shared-rows
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { sql, type SQL } from "drizzle-orm";

import {
  countEntityComponentRows,
  type TeardownComponentDataAdapter,
} from "../../field-groups/services/teardown-entity-field-group-data";
import { querySqlRows } from "../pipeline/classifier/count-helpers";
import { introspectTableNames } from "../pipeline/diff/introspect-live";

import type { Deletion, EntityRef } from "./data-loss-consent";
import {
  entityOwners,
  readCoveredEntities,
  withOwners,
  type CoveredEntity,
  type EntityOwners,
} from "./entity-coverage";

/**
 * Where an entity's field-group values are listed before the tables holding
 * them are read: a name no consent can spell, so only the entity's main table,
 * or the consent without targets, covers it.
 */
export const FIELD_GROUP_TABLES = "the field groups' tables";

/** The column pair a shared table keys an entity's rows by. */
interface SharedTable {
  table: string;
  reason: string;
  kindColumn: string;
  slugColumn: string;
  /** Narrows the rows further: the versions table's autosaves alone. */
  only?: (dialect: SupportedDialect) => SQL;
}

const SHARED_TABLES: readonly SharedTable[] = [
  {
    table: "nextly_i18n_archive",
    reason: "its archived translations",
    kindColumn: "entity_kind",
    slugColumn: "collection",
  },
  {
    table: "nextly_versions",
    reason: "its autosaves",
    kindColumn: "scope_kind",
    slugColumn: "scope_slug",
    // A boolean is stored as 1 on MySQL and SQLite.
    only: dialect =>
      sql`${sql.identifier("is_autosave")} = ${dialect === "postgresql" ? true : 1}`,
  },
  {
    table: "nextly_version_pins",
    reason: "its version pins",
    kindColumn: "scope_kind",
    slugColumn: "scope_slug",
  },
  {
    table: "nextly_version_views",
    reason: 'its readers\' "seen" markers',
    kindColumn: "scope_kind",
    slugColumn: "scope_slug",
  },
  {
    table: "nextly_dashboard_pins",
    reason: "its readers' dashboard pins",
    kindColumn: "target_type",
    slugColumn: "target_slug",
  },
  {
    table: "nextly_media_usage",
    reason: "the record of the media its documents use",
    kindColumn: "subject_kind",
    slugColumn: "subject_slug",
  },
  {
    table: "nextly_review_states",
    reason: "its documents' review state",
    kindColumn: "scope_kind",
    slugColumn: "scope_slug",
  },
];

/** The archive's kind for a row whose owner an earlier release did not record. */
const UNKNOWN_ARCHIVE_KIND = "unknown";

const FIELD_GROUP_REASON = "its field-group values";

/** The reference to an entity a listing entry carries. */
function refOf(entity: CoveredEntity): EntityRef {
  return { kind: entity.kind, slug: entity.slug };
}

/**
 * One uncounted entry for each kind of row a removal of `entity` takes from a
 * shared table, each belonging to its main table.
 */
export function entityRowsOf(entity: CoveredEntity): Deletion[] {
  const of = refOf(entity);
  return [
    {
      kind: "rows",
      table: FIELD_GROUP_TABLES,
      owner: entity.table,
      of,
      reason: FIELD_GROUP_REASON,
    },
    ...SHARED_TABLES.map(
      (shared): Deletion => ({
        kind: "rows",
        table: shared.table,
        owner: entity.table,
        of,
        reason: shared.reason,
      })
    ),
  ];
}

/**
 * A run's deletions, unit by unit, with each deletion in a table an entity
 * owns given its owner (`withOwners`), and the entity's rows in shared tables
 * listed in the unit that first drops its main table (`entityRowsOf`).
 */
export function coverRunDeletions(
  perUnit: readonly (readonly Deletion[])[],
  owners: EntityOwners
): Deletion[][] {
  const listed = new Set<string>();
  return perUnit.map(deletions => {
    const owned = withOwners(deletions, owners);
    const shared: Deletion[] = [];
    for (const deletion of owned) {
      if (deletion.kind !== "table" || deletion.owner !== undefined) continue;
      const entity = owners.mainOf(deletion.table);
      if (entity === undefined) continue;
      const key = entity.table.toLowerCase();
      if (listed.has(key)) continue;
      listed.add(key);
      shared.push(...entityRowsOf(entity));
    }
    return [...owned, ...shared];
  });
}

/** What reading the database needs: the run's connection, and the adapter where the command holds one. */
export interface SharedRowsReader {
  db: unknown;
  dialect: SupportedDialect;
  /** The command's adapter, through which the field groups' tables are found. */
  adapter?: unknown;
}

/**
 * A run's deletions as `coverRunDeletions` lists them, its entities read from
 * the registry on `reader`'s connection, and the entity rows counted
 * (`countEntityRows`). What `nextly migrate` and `migrate:down` judge.
 */
export async function withEntityCoverage(
  perUnit: readonly (readonly Deletion[])[],
  reader: SharedRowsReader
): Promise<Deletion[][]> {
  const entities = await readCoveredEntities(reader.db, reader.dialect);
  if (entities.length === 0) return perUnit.map(list => [...list]);
  const covered = coverRunDeletions(perUnit, entityOwners(entities));
  const counted: Deletion[][] = [];
  for (const list of covered) counted.push(await countEntityRows(list, reader));
  return counted;
}

/**
 * `deletions` with each entity's uncounted rows in shared tables counted on
 * the database: a table without the entity's rows, or absent, is left out, the
 * field groups' entry becomes one entry per table holding the entity's values,
 * and an entry that cannot be counted is kept without a count.
 */
export async function countEntityRows(
  deletions: readonly Deletion[],
  reader: SharedRowsReader
): Promise<Deletion[]> {
  const pending = deletions.filter(isUncountedEntityRows);
  if (pending.length === 0) return [...deletions];
  let present: ReadonlySet<string> | undefined;
  try {
    present = new Set(
      (
        await introspectTableNames(
          reader.db,
          reader.dialect,
          SHARED_TABLES.map(shared => shared.table)
        )
      ).map(name => name.toLowerCase())
    );
  } catch {
    present = undefined;
  }
  const out: Deletion[] = [];
  for (const deletion of deletions) {
    if (!isUncountedEntityRows(deletion)) {
      out.push(deletion);
      continue;
    }
    out.push(...(await counted(deletion, reader, present)));
  }
  return out;
}

/** An entity's rows in a shared table, not yet counted. */
type EntityRows = Extract<Deletion, { kind: "rows" }> & {
  of: EntityRef;
  owner: string;
};

function isUncountedEntityRows(deletion: Deletion): deletion is EntityRows {
  return (
    deletion.kind === "rows" &&
    deletion.of !== undefined &&
    deletion.owner !== undefined &&
    deletion.count === undefined
  );
}

/** One uncounted entry as counted: none, itself with a count, itself uncounted, or the field groups' tables. */
async function counted(
  deletion: EntityRows,
  reader: SharedRowsReader,
  present: ReadonlySet<string> | undefined
): Promise<Deletion[]> {
  if (deletion.table === FIELD_GROUP_TABLES) {
    return fieldGroupRows(deletion, reader);
  }
  const shared = SHARED_TABLES.find(s => s.table === deletion.table);
  if (shared === undefined || present === undefined) return [deletion];
  if (!present.has(shared.table)) return [];
  try {
    if (
      shared.table === "nextly_i18n_archive" &&
      (await countOf(reader, shared, {
        ...deletion.of,
        kind: UNKNOWN_ARCHIVE_KIND,
      })) > 0
    ) {
      // Rows of this slug whose kind is not yet known: the teardown labels
      // them and may remove them, so the count cannot be told.
      return [deletion];
    }
    const count = await countOf(reader, shared, deletion.of);
    return count === 0 ? [] : [{ ...deletion, count }];
  } catch {
    return [deletion];
  }
}

/** How many of `entity`'s rows `shared` holds. */
async function countOf(
  reader: SharedRowsReader,
  shared: SharedTable,
  entity: { kind: string; slug: string }
): Promise<number> {
  const conditions = [
    sql`${sql.identifier(shared.kindColumn)} = ${entity.kind}`,
    sql`${sql.identifier(shared.slugColumn)} = ${entity.slug}`,
    ...(shared.only === undefined ? [] : [shared.only(reader.dialect)]),
  ];
  const [row] = await querySqlRows<{ n: unknown }>(
    reader.db,
    reader.dialect,
    sql`SELECT COUNT(*) AS ${sql.identifier("n")} FROM ${sql.identifier(shared.table)} WHERE ${sql.join(conditions, sql` AND `)}`
  );
  return Number(row?.n ?? 0);
}

/**
 * The entity's field-group values, one entry per table holding any, read
 * through the command's adapter (`countEntityComponentRows`, the rows the
 * teardown starts from). Without an adapter, or when they cannot be read, the
 * one entry stays, uncounted.
 */
async function fieldGroupRows(
  deletion: EntityRows,
  reader: SharedRowsReader
): Promise<Deletion[]> {
  if (!isTeardownAdapter(reader.adapter)) return [deletion];
  try {
    const owned = await countEntityComponentRows({
      adapter: reader.adapter,
      parentTable: deletion.owner,
    });
    return owned.map(({ table, rows }) => ({
      ...deletion,
      table,
      count: rows,
    }));
  } catch {
    return [deletion];
  }
}

/** Whether `adapter` reads what finding the field groups' tables needs. */
function isTeardownAdapter(
  adapter: unknown
): adapter is TeardownComponentDataAdapter {
  if (typeof adapter !== "object" || adapter === null) return false;
  const a = adapter as Record<string, unknown>;
  return (
    typeof a.dialect === "string" &&
    ["select", "executeQuery", "getDrizzle", "tableExists", "listTables"].every(
      method => typeof a[method] === "function"
    )
  );
}
