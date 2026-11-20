/**
 * What a run that drops a collection's or Single's main table also takes of
 * it from tables every entity shares, listed before the consent is asked.
 *
 * Deleting an entity removes its rows from each shared table: its field-group
 * values, its archived translations and the record of where its translations
 * came from, its history rows (autosaves, version pins and readers' "seen"
 * markers), its readers' dashboard pins, the record of the media its documents
 * use, and its documents' review state where workflows keep one. Each is listed as that entity's rows in that table, belonging to
 * its main table, so a consent naming the main table covers them and naming
 * the shared table still covers every deletion in it. The record of content
 * events is not among them: a deletion leaves those events in place.
 *
 * A run reads the entities from the registry (`readCoveredEntities`), and
 * lists, in the file that drops an entity's main table, one entry for each
 * kind of shared row (`entityRowsOf`). Where the database can be read, each of
 * the entity's own tables is listed with its rows, and the shared entries are
 * counted (`countEntityRows`): a table without the entity's rows,
 * or absent, is left out, and one that cannot be counted is listed without a
 * count rather than failing the run. Every read is bounded by one time budget
 * per run (`ENTITY_COUNT_BUDGET_MS`). Shared rows are listed only for an
 * entity the run retires (`retiredByRun`), never for a main table dropped
 * while its entity lives on under another.
 *
 * @module domains/schema/migrate/entity-shared-rows
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { sql, type SQL } from "drizzle-orm";

import {
  countEntityComponentRows,
  countEntityComponentTree,
  type TeardownComponentDataAdapter,
} from "../../field-groups/services/teardown-entity-field-group-data";
import { carriesRegistryMetadata } from "../migrate-create/snapshot-io";
import { querySqlRows } from "../pipeline/classifier/count-helpers";
import { introspectTableNames } from "../pipeline/diff/introspect-live";

import type { Deletion, EntityRef } from "./data-loss-consent";
import {
  entityOwners,
  readCoveredEntities,
  tableIdentifierCase,
  withOwners,
  type CoveredEntity,
  type EntityOwners,
} from "./entity-coverage";
import { readMigrationSnapshot } from "./rollback-to-record";

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
    // Purged with the archive when the entity's translations are torn down.
    table: "nextly_translation_provenance",
    reason: "the record of where its translations came from",
    kindColumn: "scope_kind",
    slugColumn: "scope_slug",
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
  // A field group has no versions, pins, documents or provenance of its own: only the values
  // nested in it and its archived translations go with it.
  const shared =
    entity.kind === "fieldGroup"
      ? SHARED_TABLES.filter(table => table.table === "nextly_i18n_archive")
      : SHARED_TABLES;
  return [
    {
      kind: "rows",
      table: FIELD_GROUP_TABLES,
      owner: entity.table,
      of,
      reason: FIELD_GROUP_REASON,
    },
    ...shared.map(
      (table): Deletion => ({
        kind: "rows",
        table: table.table,
        owner: entity.table,
        of,
        reason: table.reason,
      })
    ),
  ];
}

/**
 * A run's deletions, unit by unit, with each deletion in a table an entity
 * owns given its owner (`withOwners`), and, for an entity the run retires
 * (`retires`, every one when unknown), its rows in shared tables listed in the
 * unit that first drops its main table (`entityRowsOf`). A main table dropped
 * while its entity lives on under another, as a change of `dbName` leaves it,
 * takes none of the entity's shared rows with it.
 */
export function coverRunDeletions(
  perUnit: readonly (readonly Deletion[])[],
  owners: EntityOwners,
  retires: (entity: EntityRef) => boolean = () => true
): Deletion[][] {
  // Keyed by the entity `mainOf` resolves, which compares table names by the server's rule: one
  // entity dropped under two spellings is listed once, two entities whose tables differ only in
  // case on a server that keeps case are listed each.
  const listed = new Set<CoveredEntity>();
  return perUnit.map(deletions => {
    const owned = withOwners(deletions, owners);
    const shared: Deletion[] = [];
    for (const deletion of owned) {
      if (deletion.kind !== "table" || deletion.owner !== undefined) continue;
      const entity = owners.mainOf(deletion.table);
      if (entity === undefined || !retires(entity)) continue;
      if (listed.has(entity)) continue;
      listed.add(entity);
      shared.push(...entityRowsOf(entity));
    }
    return [...owned, ...shared];
  });
}

/**
 * Which entities a run retires: those the snapshot of the last of `names`
 * (the run's migrations, oldest first) that records the registry leaves out,
 * as `nextly migrate` removes a registry row once the newest applied snapshot
 * no longer records it. Undefined when no snapshot of the run says, and a
 * drop of a main table is then listed as a retirement: the consent asked is
 * never narrower than what the run may remove.
 */
export async function retiredByRun(
  metaDir: string,
  names: readonly string[]
): Promise<((entity: EntityRef) => boolean) | undefined> {
  for (const name of [...names].reverse()) {
    let snapshot: Awaited<ReturnType<typeof readMigrationSnapshot>>;
    try {
      snapshot = await readMigrationSnapshot(metaDir, name);
    } catch {
      return undefined;
    }
    if (snapshot === null) continue;
    if (!carriesRegistryMetadata(snapshot)) return undefined;
    const { entities } = snapshot;
    // Each kind is recorded under its own key: a collection, a Single and a field group may
    // share a slug.
    const recordedOf = {
      collection: entities.collections,
      single: entities.singles,
      fieldGroup: entities.fieldGroups,
    } as const;
    return entity => !(entity.slug in recordedOf[entity.kind]);
  }
  return undefined;
}

/** How long a run's counts may take in all, after which what is left is listed without a count. */
const ENTITY_COUNT_BUDGET_MS = 5_000;

/** What reading the database needs: the run's connection, and the adapter where the command holds one. */
export interface SharedRowsReader {
  db: unknown;
  dialect: SupportedDialect;
  /** The command's adapter, through which the field groups' tables are found. */
  adapter?: unknown;
  /** Which entities the run retires (`retiredByRun`); every one whose main table it drops when absent. */
  retires?: (entity: EntityRef) => boolean;
  /** How long the counts may take in all (`ENTITY_COUNT_BUDGET_MS` when absent). */
  budgetMs?: number;
}

/**
 * A run's deletions as `coverRunDeletions` lists them, its entities read from
 * the registry on `reader`'s connection, each of the entity's own tables
 * listed with its rows, and the entity rows in shared tables counted
 * (`countEntityRows`). What `nextly migrate` and `migrate:down` judge.
 *
 * Every read is bounded by the run's budget, on the database as well where it
 * can be (`boundedCount`): a large table or one another transaction holds
 * costs at most the budget, and is listed without a count. A registry that
 * cannot be read in time covers nothing, so each table must be named.
 */
export async function withEntityCoverage(
  perUnit: readonly (readonly Deletion[])[],
  reader: SharedRowsReader
): Promise<Deletion[][]> {
  // A run that deletes nothing has nothing to cover: the registry is not read.
  if (perUnit.every(list => list.length === 0)) {
    return perUnit.map(list => [...list]);
  }
  const deadline = Date.now() + (reader.budgetMs ?? ENTITY_COUNT_BUDGET_MS);
  const entities =
    (await within(readCoveredEntities(reader.db, reader.dialect), deadline)) ??
    [];
  if (entities.length === 0) return perUnit.map(list => [...list]);
  // Tables are matched by the server's own rule for comparing their names.
  const owners = entityOwners(entities, {
    identifierCase:
      (await within(
        tableIdentifierCase(reader.db, reader.dialect),
        deadline
      )) ?? "preserve",
  });
  const covered = coverRunDeletions(perUnit, owners, reader.retires);
  const counted: Deletion[][] = [];
  for (const list of covered) {
    const tablesCounted = await countEntityTables(
      list,
      owners,
      reader,
      deadline
    );
    counted.push(await countEntityRows(tablesCounted, reader, deadline));
  }
  return counted;
}

/**
 * `deletions` with each of an entity's own tables listed with its rows: the
 * main table and every table it owns, counted within `deadline`. Another
 * deletion keeps what its reading gave it.
 */
async function countEntityTables(
  deletions: readonly Deletion[],
  owners: EntityOwners,
  reader: SharedRowsReader,
  deadline: number
): Promise<Deletion[]> {
  const listed: Deletion[] = [];
  for (const deletion of deletions) {
    const ofEntity =
      deletion.kind === "table" &&
      deletion.count === undefined &&
      (deletion.owner !== undefined ||
        owners.mainOf(deletion.table) !== undefined);
    if (!ofEntity) {
      listed.push(deletion);
      continue;
    }
    const count = await boundedCount(
      reader,
      deletion.table,
      undefined,
      deadline
    );
    listed.push(count === undefined ? deletion : { ...deletion, count });
  }
  return listed;
}

/**
 * `deletions` with each entity's uncounted rows in shared tables counted on
 * the database by `deadline`: a table without the entity's rows, or absent, is
 * left out, the field groups' entry becomes one entry per table holding the
 * entity's values, and an entry that cannot be counted in time is kept
 * without a count.
 */
export async function countEntityRows(
  deletions: readonly Deletion[],
  reader: SharedRowsReader,
  deadline: number = Date.now() + (reader.budgetMs ?? ENTITY_COUNT_BUDGET_MS)
): Promise<Deletion[]> {
  const pending = deletions.filter(isUncountedEntityRows);
  if (pending.length === 0) return [...deletions];
  const names = await within(
    introspectTableNames(
      reader.db,
      reader.dialect,
      SHARED_TABLES.map(shared => shared.table)
    ),
    deadline
  );
  const present =
    names === undefined
      ? undefined
      : new Set(names.map(name => name.toLowerCase()));
  const out: Deletion[] = [];
  for (const deletion of deletions) {
    if (!isUncountedEntityRows(deletion)) {
      out.push(deletion);
      continue;
    }
    out.push(...(await counted(deletion, reader, present, deadline)));
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
  present: ReadonlySet<string> | undefined,
  deadline: number
): Promise<Deletion[]> {
  if (deletion.table === FIELD_GROUP_TABLES) {
    return fieldGroupRows(deletion, reader, deadline);
  }
  const shared = SHARED_TABLES.find(s => s.table === deletion.table);
  if (shared === undefined || present === undefined) return [deletion];
  if (!present.has(shared.table)) return [];
  if (await archiveOwnerUnknown(reader, shared, deletion.of, deadline)) {
    return [deletion];
  }
  return withCount(
    deletion,
    await boundedCount(
      reader,
      shared.table,
      entityWhere(reader, shared, deletion.of),
      deadline
    )
  );
}

/** The rows `shared` keys to `entity`, as the entity's delete selects them. */
function entityWhere(
  reader: SharedRowsReader,
  shared: SharedTable,
  entity: { kind: string; slug: string }
): SQL {
  return sql.join(
    [
      sql`${sql.identifier(shared.kindColumn)} = ${entity.kind}`,
      sql`${sql.identifier(shared.slugColumn)} = ${entity.slug}`,
      ...(shared.only === undefined ? [] : [shared.only(reader.dialect)]),
    ],
    sql` AND `
  );
}

/**
 * Whether the archive holds rows of the entity's slug whose kind an earlier release did not
 * record, or cannot say in time: the teardown labels such rows and may remove them, so the
 * entity's count cannot be told. Never for another shared table.
 */
async function archiveOwnerUnknown(
  reader: SharedRowsReader,
  shared: SharedTable,
  entity: EntityRef,
  deadline: number
): Promise<boolean> {
  if (shared.table !== "nextly_i18n_archive") return false;
  const unknown = await boundedCount(
    reader,
    shared.table,
    entityWhere(reader, shared, { ...entity, kind: UNKNOWN_ARCHIVE_KIND }),
    deadline
  );
  return unknown === undefined || unknown > 0;
}

/** An entry as counted: itself uncounted when the count failed, none when it found no rows. */
function withCount(
  deletion: EntityRows,
  count: number | undefined
): Deletion[] {
  if (count === undefined) return [deletion];
  return count === 0 ? [] : [{ ...deletion, count }];
}

/**
 * The rows of `table` (those matching `where`, when given), or undefined when
 * they cannot be counted by `deadline`. The database stops the count at the
 * deadline too, where it can: PostgreSQL through the transaction's statement
 * timeout, MySQL through the statement's execution-time hint. So no count
 * outlives the run's budget holding the table a later statement drops.
 * SQLite counts in the call itself, so its budget is checked before each.
 */
async function boundedCount(
  reader: SharedRowsReader,
  table: string,
  where: SQL | undefined,
  deadline: number
): Promise<number | undefined> {
  const left = Math.ceil(deadline - Date.now());
  if (left <= 0) return undefined;
  const hint =
    reader.dialect === "mysql"
      ? sql.raw(`/*+ MAX_EXECUTION_TIME(${String(left)}) */ `)
      : sql``;
  const query = sql`SELECT ${hint}COUNT(*) AS ${sql.identifier("n")} FROM ${sql.identifier(table)}${
    where === undefined ? sql`` : sql` WHERE ${where}`
  }`;
  const read = async (): Promise<number> => {
    if (reader.dialect !== "postgresql") {
      const [row] = await querySqlRows<{ n: unknown }>(
        reader.db,
        reader.dialect,
        query
      );
      return Number(row?.n ?? 0);
    }
    const db = reader.db as {
      transaction: <T>(work: (tx: unknown) => Promise<T>) => Promise<T>;
    };
    return db.transaction(async tx => {
      await (tx as { execute: (q: SQL) => Promise<unknown> }).execute(
        sql`SET LOCAL statement_timeout = ${sql.raw(String(left))}`
      );
      const [row] = await querySqlRows<{ n: unknown }>(tx, "postgresql", query);
      return Number(row?.n ?? 0);
    });
  };
  return within(read(), deadline);
}

/** `work`'s value, or undefined when it fails or has not settled by `deadline`; a late one is not waited for. */
async function within<T>(
  work: Promise<T>,
  deadline: number
): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>(settle => {
    timer = setTimeout(
      () => settle(undefined),
      Math.max(0, deadline - Date.now())
    );
  });
  try {
    return await Promise.race([work.catch(() => undefined), late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The entity's field-group values, one entry per table holding any, at every
 * level of nesting and with their translations, read through the command's
 * adapter by the walk the teardown takes (`countEntityComponentTree`).
 * Without an adapter, or when they cannot be read by `deadline`, the one entry
 * stays, uncounted.
 */
async function fieldGroupRows(
  deletion: EntityRows,
  reader: SharedRowsReader,
  deadline: number
): Promise<Deletion[]> {
  if (!isTeardownAdapter(reader.adapter)) return [deletion];
  const args = { adapter: reader.adapter, parentTable: deletion.owner };
  const tree = await within(countEntityComponentTree(args), deadline);
  if (tree !== undefined) return countedIn(deletion, tree);
  // The walk reads each level through the ORM, which cannot address a component table no schema
  // registers (a command run outside a booted instance), and refuses where one holds rows. The
  // entity's own level is still counted, by its parent table; what is nested below it goes too,
  // and is listed as the field groups' tables, uncounted. Nothing is nested where nothing is held.
  const direct = await within(countEntityComponentRows(args), deadline);
  if (direct === undefined) return [deletion];
  if (direct.length === 0) return [];
  return [
    ...countedIn(deletion, direct),
    { ...deletion, reason: "the field-group values nested in them" },
  ];
}

/** The entity's field-group values, one entry per table, each with its count. */
function countedIn(
  deletion: EntityRows,
  owned: readonly { table: string; rows: number }[]
): Deletion[] {
  return owned.map(({ table, rows }) => ({
    ...deletion,
    table,
    count: rows,
  }));
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
