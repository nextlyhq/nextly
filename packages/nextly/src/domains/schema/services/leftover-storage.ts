/**
 * What a create does about a table already standing where it is about to build.
 *
 * `CREATE TABLE IF NOT EXISTS` is a no-op against a table that exists, on every dialect, and the
 * statement runner tolerates already-applied index statements so half-applied schema can be
 * finished. Together those make a create over a LEFTOVER table silent: a create interrupted between
 * its DDL and its registry write leaves a table no row describes, and a retry with different fields
 * would adopt that table unchanged, recording itself applied over columns it never made.
 *
 * So a standing table is never built over. Which way it goes is decided by the one thing a leftover
 * cannot have:
 *
 * - **Every table empty:** it is wreckage of an interrupted attempt. The caller has re-asserted,
 *   inside the schema lock, that nothing registered owns the name, and a table outside every
 *   registered entity's family is one no Nextly path writes rows through. The family is dropped, so
 *   the create renders every column from its own request.
 * - **Any table holding rows:** it is somebody's data, and dropping it would destroy what proves it
 *   is not wreckage. The create is refused, naming each such table and how many rows it holds.
 *   Nothing has run and nothing is recorded, so the name stays free for a retry once the table is
 *   dealt with.
 *
 * Every table is probed before any is dropped, so a refusal leaves the whole family as it stood.
 * One rule for every kind's create: a collection's, a field group's and a Single's.
 *
 * @module domains/schema/services/leftover-storage
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../../errors/nextly-error";
import { introspectLiveColumns } from "../pipeline/diff/introspect-live";
import {
  countTableRows,
  readDependentViews,
  readReferencingTables,
  tableHasRows,
} from "../pipeline/live-table-facts";

/** The adapter surface the rule needs: whether a table stands, the database, and a drop. */
export interface LeftoverStorageAdapter {
  tableExists(tableName: string): Promise<boolean>;
  getDrizzle(): unknown;
  getCapabilities(): { dialect: SupportedDialect };
  dropTable(
    tableName: string,
    options?: { ifExists?: boolean; cascade?: boolean }
  ): Promise<void>;
}

export interface ClearLeftoverStorageArgs {
  adapter: LeftoverStorageAdapter;
  /** The kind of entity being created, named in the refusal and the log. */
  kind: "collection" | "fieldGroup" | "single";
  slug: string;
  /** The main table the create is about to build. */
  tableName: string;
  /**
   * Drop the main table and what the kind keeps beside it (its translations table, and for a
   * Single its field-group data). Called only once every table has been found empty, after the
   * tables referencing the main one are gone.
   */
  dropFamily: () => Promise<void>;
  /**
   * Whether this kind's create makes junction tables, which reference its main table. A field
   * group makes none (a component row keeps a many-to-many as a list of its own), so for it every
   * table referencing the leftover belongs to something else.
   */
  makesJunctionTables: boolean;
  /**
   * The junction tables this create is about to build, by the names its own fields give them,
   * a name `options.junctionTable` gives included. A
   * leftover junction can outlive its main table (PostgreSQL's CASCADE strips the junction's
   * foreign key and leaves the table), where nothing references the main table any more, so the
   * names the create will build are looked at directly.
   */
  plannedJunctions?: readonly string[];
  /**
   * The rows that belong to the leftover in tables outside its family, which `dropFamily` would
   * take with it: a Single's field-group rows, in the shared field-group tables, that name its
   * table as their parent. Counted as the family's own rows are, so a leftover whose content
   * lives there is refused rather than cleared.
   */
  ownedElsewhere?: () => Promise<OccupiedTable[]>;
  logger: { info(message: string): void };
}

/** A table holding rows, and how many. */
export interface OccupiedTable {
  table: string;
  rows: number;
}

const KIND_NAMES: Record<ClearLeftoverStorageArgs["kind"], string> = {
  collection: "collection",
  fieldGroup: "field group",
  single: "Single",
};

/**
 * Whether `candidate` is a junction table a create of this kind made for the leftover: named as
 * `junctionTableNameBetween` names one (the leftover's table and another, sorted, then the field),
 * where that other table stands, and keying both by their `_id` columns, as a junction does. A
 * name and one column are not enough: a host table may carry the leftover's name in its own and
 * key it. Anything that is not such a junction is someone else's, and is never dropped.
 */
async function isGeneratedJunctionOf(
  args: ClearLeftoverStorageArgs,
  db: unknown,
  dialect: SupportedDialect,
  candidate: string
): Promise<boolean> {
  if (!args.makesJunctionTables) return false;
  const columns = new Set(
    (
      (await introspectLiveColumns(db, dialect, [candidate])).tables[0]
        ?.columns ?? []
    ).map(column => column.name)
  );
  if (!columns.has(idColumnOf(args.tableName))) return false;
  for (const other of otherTablesNamedIn(args.tableName, candidate)) {
    if (
      columns.has(idColumnOf(other)) &&
      (await args.adapter.tableExists(other))
    ) {
      return true;
    }
  }
  return false;
}

/** The column a junction keys a table by: its slug, without the collection prefix, then `_id`. */
function idColumnOf(table: string): string {
  return `${table.replace(/^dc_/, "")}_id`;
}

/**
 * Each table `candidate` could join to `tableName` under the junction naming rule, which writes
 * both tables sorted and then the field: `<tableName>_<other>_<field>` for a table sorting after
 * it, `<other>_<tableName>_<field>` for one sorting before. The other is always a collection's
 * (`dc_<target>`). A table name may itself hold underscores, so every split is a candidate.
 */
function otherTablesNamedIn(tableName: string, candidate: string): string[] {
  const others: string[] = [];
  if (candidate.startsWith(`${tableName}_`)) {
    const rest = candidate.slice(tableName.length + 1);
    for (let at = rest.indexOf("_"); at > 0; at = rest.indexOf("_", at + 1)) {
      const other = rest.slice(0, at);
      if (other > tableName && other.startsWith("dc_")) others.push(other);
    }
  }
  const at = candidate.indexOf(`_${tableName}_`);
  if (at > 0) {
    const other = candidate.slice(0, at);
    if (other < tableName && other.startsWith("dc_")) others.push(other);
  }
  return others;
}

/** The rows each table of `tables` holds, for those holding any. */
async function occupiedAmong(
  db: unknown,
  dialect: SupportedDialect,
  tables: readonly string[]
): Promise<OccupiedTable[]> {
  const occupied: OccupiedTable[] = [];
  for (const table of tables) {
    if (await tableHasRows(db, dialect, table)) {
      occupied.push({ table, rows: await countTableRows(db, dialect, table) });
    }
  }
  return occupied;
}

/**
 * Leave the create's table name pointing at nothing, or refuse the create.
 *
 * The family is the main table, its `_locales` translations table (looked at whether or not the
 * main table survived: a drop that cascaded from it can leave the translations behind) and the
 * junction tables a create of this kind generated for it, read from the live catalog because a
 * leftover's field list is gone with its registry row. A table referencing the main one that is
 * not such a junction belongs to something else, so the create is refused rather than drop it.
 * Junction tables are dropped first: they hold the foreign keys, and MySQL refuses to drop a parent
 * a reference still points at.
 */
export async function clearLeftoverStorage(
  args: ClearLeftoverStorageArgs
): Promise<void> {
  const { adapter, tableName } = args;
  const companion = `${tableName}_locales`;
  const mainStands = await adapter.tableExists(tableName);
  const companionStands = await adapter.tableExists(companion);
  const plannedStanding = await standingAmong(
    adapter,
    args.plannedJunctions ?? []
  );
  // Rows naming the leftover from tables outside its family outlive its tables: a create with
  // none standing would take them over as its own, so they refuse it either way.
  const elsewhere = (await args.ownedElsewhere?.()) ?? [];
  if (!mainStands && !companionStands && plannedStanding.length === 0) {
    if (elsewhere.length > 0) throw occupiedRefusal(args, elsewhere);
    return;
  }

  const db = adapter.getDrizzle();
  const dialect = adapter.getCapabilities().dialect;
  const referencing = mainStands
    ? (await readReferencingTables(db, dialect, tableName)).filter(
        name => name !== companion
      )
    : [];
  const { junctions, others } = await sortReferencing(
    args,
    db,
    dialect,
    referencing
  );
  if (others.length > 0) throw referencedRefusal(args, others);
  // A table standing where the create will build a junction is dropped only when it is one this
  // kind generates for this table; a name given by `options.junctionTable`, or any table not keyed
  // as such a junction, may be someone else's, and refuses the create.
  const planned = await sortReferencing(args, db, dialect, plannedStanding);
  if (planned.others.length > 0) {
    throw takenRefusal(args, planned.others);
  }

  // A planned junction still referencing the main table was found above as well; once each.
  const ownJunctions = [...new Set([...junctions, ...planned.junctions])];
  const family = [
    ...(mainStands ? [tableName] : []),
    ...(companionStands ? [companion] : []),
    ...ownJunctions,
  ];
  const occupied = [
    ...(await occupiedAmong(db, dialect, family)),
    ...elsewhere,
  ];
  if (occupied.length > 0) throw occupiedRefusal(args, occupied);
  // A view reading one of these tables would go with it, unasked, under PostgreSQL's CASCADE.
  const views = await viewsOver(db, dialect, family);
  if (views.length > 0) throw takenRefusal(args, views);

  args.logger.info(
    `Dropping empty unregistered tables ${family.map(table => `"${table}"`).join(", ")} before creating the ${KIND_NAMES[args.kind]} "${args.slug}"`
  );
  for (const table of ownJunctions) {
    await adapter.dropTable(table, { ifExists: true });
  }
  await args.dropFamily();
}

/** Those of `tables` that stand. */
async function standingAmong(
  adapter: LeftoverStorageAdapter,
  tables: readonly string[]
): Promise<string[]> {
  const standing: string[] = [];
  for (const table of tables) {
    if (await adapter.tableExists(table)) standing.push(table);
  }
  return standing;
}

/** The tables referencing the leftover, as this kind's own junctions and everything else. */
async function sortReferencing(
  args: ClearLeftoverStorageArgs,
  db: unknown,
  dialect: SupportedDialect,
  referencing: readonly string[]
): Promise<{ junctions: string[]; others: string[] }> {
  const junctions: string[] = [];
  const others: string[] = [];
  for (const table of referencing) {
    const own = await isGeneratedJunctionOf(args, db, dialect, table);
    (own ? junctions : others).push(table);
  }
  return { junctions, others };
}

/** The views reading any of `tables`. */
async function viewsOver(
  db: unknown,
  dialect: SupportedDialect,
  tables: readonly string[]
): Promise<string[]> {
  const views = new Set<string>();
  for (const table of tables) {
    for (const view of await readDependentViews(db, dialect, table)) {
      views.add(view);
    }
  }
  return [...views];
}

/** The refusal of a create where objects stand that nothing registered owns and it would remove. */
function takenRefusal(
  args: ClearLeftoverStorageArgs,
  objects: readonly string[]
): NextlyError {
  const { kind, slug, tableName } = args;
  const named = objects.map(object => `"${object}"`).join(", ");
  return NextlyError.conflict({
    reason: "state",
    message:
      `Creating the ${KIND_NAMES[kind]} "${slug}" was refused: ${named} ` +
      `${objects.length === 1 ? "stands" : "stand"} where it would build, or ` +
      `${objects.length === 1 ? "reads" : "read"} what it would replace, and nothing registered ` +
      "owns it. Drop or rename it, then retry the create.",
    logContext: {
      reason: "create-objects-taken",
      kind,
      slug,
      tableName,
      objects,
    },
  });
}

/** The refusal of a create whose leftover other tables reference. */
function referencedRefusal(
  args: ClearLeftoverStorageArgs,
  others: readonly string[]
): NextlyError {
  const { kind, slug, tableName } = args;
  const named = others.map(table => `"${table}"`).join(", ");
  return NextlyError.conflict({
    reason: "state",
    message:
      `Creating the ${KIND_NAMES[kind]} "${slug}" was refused: "${tableName}" already exists, ` +
      `and ${named} ${others.length === 1 ? "references" : "reference"} it, which nothing ` +
      "registered owns. Drop or rename those tables, then retry the create.",
    logContext: {
      reason: "create-table-referenced",
      kind,
      slug,
      tableName,
      referencedBy: others,
    },
  });
}

/** The refusal of a create whose leftover family holds rows, naming each table and its rows. */
function occupiedRefusal(
  args: ClearLeftoverStorageArgs,
  occupied: readonly OccupiedTable[]
): NextlyError {
  const { kind, slug, tableName } = args;
  const named = occupied
    .map(
      ({ table, rows }) => `"${table}" (${rows} ${rows === 1 ? "row" : "rows"})`
    )
    .join(", ");
  return NextlyError.conflict({
    reason: "state",
    message:
      `Creating the ${KIND_NAMES[kind]} "${slug}" was refused: ${named} already ` +
      `${occupied.length === 1 ? "exists and holds" : "exist and hold"} rows, but nothing ` +
      "registered describes them. Drop or rename those tables, then retry the create.",
    logContext: {
      reason: "create-table-occupied",
      kind,
      slug,
      tableName,
      occupied,
    },
  });
}
