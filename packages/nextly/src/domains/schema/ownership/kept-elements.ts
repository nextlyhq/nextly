/**
 * What a development push keeps of the elements a removed plugin added to
 * tables it does not own, and what it refuses to change of them.
 *
 * A plugin may add a column, an index, a foreign key or a check to a table
 * another owner declared: a collection's, a Single's, a component's, another
 * plugin's or the app's. The push builds the database's desired state from the
 * configuration, so once the plugin leaves the configuration nothing declares
 * those elements any more, and the push would plan to drop them with the
 * values they hold. That is the change no owner asked for: the table's owner
 * never declared them, and their contributor is not there to decide.
 *
 * So the push records who added each element (`ownerRowsToRecord`), as
 * `nextly migrate` does, and keeps the elements whose recorded owner no longer
 * declares any schema (`keptElements`): they are added to the desired state
 * as the database has them, so no route plans their drop. A plugin removed
 * from the configuration keeps what it added, as it keeps its tables, until
 * `nextly plugins uninstall` removes them or the plugin returns.
 *
 * A contributor that is still configured and stops declaring one of its
 * elements has removed it, and the push drops that one (it is the
 * contributor's own change). The app is always configured.
 *
 * What the push would still change of a kept owner's element — another owner
 * declaring an element of the same name with a different shape — is refused
 * before anything runs, naming the element and its owner
 * (`refuseChangesToKeptElements`).
 *
 * @module domains/schema/ownership/kept-elements
 */
import type { SupportedDialect } from "../../../database/schema-registry";
import { NextlyError } from "../../../errors/nextly-error";
import type { ExtensionSchema } from "../extension/build-extension-schema";
import { resolveIndexName } from "../extension/compile";
import { enumChecks } from "../extension/enum-check";
import type { SchemaOwner } from "../extension/types";
import type {
  NextlySchemaSnapshot,
  Operation,
  TableSpec,
} from "../pipeline/diff/types";

import { ELEMENT_NOUNS, ownerRecordKey, type OwnerRecord } from "./owner-registry";

/** The kinds of element one owner can add to another's table. */
export type ElementKind = "column" | "index" | "fk" | "check";

/** The parts of a compiled extension schema these questions read. */
export type ContributionSource = Pick<
  ExtensionSchema,
  "owners" | "elementOwners" | "entityColumns" | "entityIndexes"
>;

/** One element a contributor added to a table another owner declared. */
export interface ContributedElement {
  table: string;
  elementKind: ElementKind;
  elementName: string;
  owner: SchemaOwner;
}

/** An element the push keeps although nothing declares it any more. */
export interface KeptElement {
  table: string;
  kind: ElementKind;
  name: string;
  /** The plugin its owner row names, which no longer declares any schema. */
  ownerId: string;
}

/** How an owner row spells an owner. */
function ownerIdOf(owner: SchemaOwner): string {
  return owner.kind === "plugin" ? owner.id : "app";
}

/**
 * Every element the compiled schema says one owner added to another's table.
 *
 * Two records hold them. A plugin's or the app's table carries them as
 * element owners. A collection's, Single's, component's or core table's
 * carries them as hidden columns and indexes, each naming its contributor,
 * with the check a contributed `col.enum()` implies belonging to its column's
 * contributor.
 */
export function contributedElements(
  schema: ContributionSource | null | undefined,
  dialect: SupportedDialect
): ContributedElement[] {
  if (!schema) return [];
  const out: ContributedElement[] = [];
  for (const [table, elements] of schema.elementOwners) {
    for (const element of elements) out.push({ table, ...element });
  }
  for (const [table, columns] of schema.entityColumns) {
    for (const column of columns) {
      if (column.contributedBy === undefined) continue;
      out.push({
        table,
        elementKind: "column",
        elementName: column.name,
        owner: column.contributedBy,
      });
      for (const check of enumChecks(table, [column], dialect)) {
        out.push({
          table,
          elementKind: "check",
          elementName: check.name,
          owner: column.contributedBy,
        });
      }
    }
  }
  for (const [table, indexes] of schema.entityIndexes) {
    for (const index of indexes) {
      if (index.contributedBy === undefined) continue;
      out.push({
        table,
        elementKind: "index",
        elementName: resolveIndexName(table, index),
        owner: index.contributedBy,
      });
    }
  }
  return out;
}

/**
 * The owners the configuration still has a schema declaration from, as owner
 * rows spell them: the app always, and every plugin that declares a table or
 * adds an element to one.
 *
 * A plugin that declares nothing any more is read as removed. Its tables are
 * already kept (the push manages only the tables the configuration declares),
 * and its elements on other owners' tables are kept the same way.
 */
export function declaringOwners(
  schema: ContributionSource | null | undefined,
  dialect: SupportedDialect
): Set<string> {
  const owners = new Set<string>(["app"]);
  for (const owner of schema?.owners.values() ?? []) {
    owners.add(ownerIdOf(owner));
  }
  for (const element of contributedElements(schema, dialect)) {
    owners.add(ownerIdOf(element.owner));
  }
  return owners;
}

/**
 * The element owner rows the push writes for what the configuration
 * contributes, leaving out the ones already recorded.
 *
 * Only absent rows are written. A row `nextly migrate` wrote carries the
 * owner's version and applied schema version, which a push does not know and
 * must not overwrite. The stream named is the one that carries the element:
 * the contributor's own for an element on a plugin's or the app's table, and
 * the app's for one on a collection's, Single's, component's or core table,
 * whose contributions ride the app's migrations.
 */
export function ownerRowsToRecord(
  contributed: readonly ContributedElement[],
  extensionTables: ReadonlySet<string>,
  existing: readonly OwnerRecord[]
): OwnerRecord[] {
  const recorded = new Set(existing.map(row => ownerRecordKey(row)));
  const rows: OwnerRecord[] = [];
  for (const element of contributed) {
    const row: OwnerRecord = {
      tableName: element.table,
      elementKind: element.elementKind,
      elementName: element.elementName,
      ownerKind: element.owner.kind,
      ownerId: ownerIdOf(element.owner),
      migratedBy:
        element.owner.kind === "plugin" && extensionTables.has(element.table)
          ? `plugin:${element.owner.id}`
          : "app",
      ownerVersion: null,
      schemaVersion: null,
      state: "active",
    };
    const key = ownerRecordKey(row);
    if (recorded.has(key)) continue;
    recorded.add(key);
    rows.push(row);
  }
  return rows;
}

/** Where each element kind lives on a table spec. */
const DIMENSION = {
  column: "columns",
  index: "indexes",
  fk: "foreignKeys",
  check: "checks",
} as const satisfies Record<ElementKind, keyof TableSpec>;

/** The named elements of one dimension of a table, or undefined if untracked. */
function elementsOf(
  table: TableSpec | undefined,
  kind: ElementKind
): readonly { name: string }[] | undefined {
  return table?.[DIMENSION[kind]];
}

/** Tables by lower-cased name. */
function byName(snapshot: NextlySchemaSnapshot): Map<string, TableSpec> {
  return new Map(
    snapshot.tables.map(table => [table.name.toLowerCase(), table])
  );
}

/**
 * The elements the push keeps: each one an owner row records for a plugin
 * that declares no schema any more, that the database has on a table the
 * push manages, and that the desired state leaves out.
 *
 * A dimension the desired table does not track (`undefined`) plans no drop,
 * so nothing in it needs keeping.
 */
export function keptElements(input: {
  rows: readonly OwnerRecord[];
  declaring: ReadonlySet<string>;
  live: NextlySchemaSnapshot;
  desired: NextlySchemaSnapshot;
}): KeptElement[] {
  const live = byName(input.live);
  const desired = byName(input.desired);
  const kept: KeptElement[] = [];
  for (const row of input.rows) {
    const kind = row.elementKind ?? "table";
    if (kind === "table") continue;
    if (row.ownerKind !== "plugin" || input.declaring.has(row.ownerId)) {
      continue;
    }
    const table = row.tableName.toLowerCase();
    const name = row.elementName ?? "";
    const liveTable = live.get(table);
    const desiredTable = desired.get(table);
    if (liveTable === undefined || desiredTable === undefined) continue;
    if (!elementsOf(liveTable, kind)?.some(e => e.name === name)) continue;
    const wanted = elementsOf(desiredTable, kind);
    if (wanted === undefined || wanted.some(e => e.name === name)) continue;
    kept.push({ table: desiredTable.name, kind, name, ownerId: row.ownerId });
  }
  return kept;
}

/**
 * `desired` with each kept element added to its table as the database has
 * it, so the diff plans nothing for it and every strip of drizzle-kit's drops
 * reads it as declared.
 */
export function withKeptElements(
  desired: NextlySchemaSnapshot,
  live: NextlySchemaSnapshot,
  kept: readonly KeptElement[]
): NextlySchemaSnapshot {
  if (kept.length === 0) return desired;
  const liveTables = byName(live);
  return {
    ...desired,
    tables: desired.tables.map(table => {
      const mine = kept.filter(
        element => element.table.toLowerCase() === table.name.toLowerCase()
      );
      if (mine.length === 0) return table;
      const liveTable = liveTables.get(table.name.toLowerCase());
      const from = <T extends { name: string }>(
        kind: ElementKind,
        current: readonly T[] | undefined
      ): T[] | undefined => {
        if (current === undefined) return undefined;
        const add = mine
          .filter(element => element.kind === kind)
          .flatMap(element =>
            (
              (elementsOf(liveTable, kind) ?? []) as readonly T[]
            ).filter(live => live.name === element.name)
          );
        return add.length === 0 ? [...current] : [...current, ...add];
      };
      const indexes = from("index", table.indexes);
      const foreignKeys = from("fk", table.foreignKeys);
      const checks = from("check", table.checks);
      return {
        ...table,
        columns: from("column", table.columns) ?? table.columns,
        ...(indexes !== undefined ? { indexes } : {}),
        ...(foreignKeys !== undefined ? { foreignKeys } : {}),
        ...(checks !== undefined ? { checks } : {}),
      };
    }),
  };
}

/** One element an operation changes, and how. */
interface Change {
  table: string;
  kind: ElementKind;
  name: string;
  act: string;
}

/** The element an operation drops, renames or changes, if it names one. */
function changeOf(op: Operation): Change | undefined {
  switch (op.type) {
    case "drop_column":
      return { table: op.tableName, kind: "column", name: op.columnName, act: "drop" };
    case "rename_column":
      return { table: op.tableName, kind: "column", name: op.fromColumn, act: "rename" };
    case "change_column_type":
    case "change_column_nullable":
    case "change_column_default":
      return { table: op.tableName, kind: "column", name: op.columnName, act: "change" };
    case "drop_index":
      return { table: op.tableName, kind: "index", name: op.index.name, act: "drop" };
    case "drop_check":
      return { table: op.tableName, kind: "check", name: op.check.name, act: "drop" };
    case "drop_foreign_key":
      return { table: op.tableName, kind: "fk", name: op.foreignKey.name, act: "drop" };
    case "change_foreign_key_action":
      return { table: op.tableName, kind: "fk", name: op.constraintName, act: "change" };
    default:
      return undefined;
  }
}

/** The refusal of a push that would change a removed plugin's element. */
function keptElementRefusal(change: Change, ownerId: string, why?: string): NextlyError {
  const noun = ELEMENT_NOUNS[change.kind];
  return NextlyError.validation({
    errors: [
      {
        path: `schema.${change.table}`,
        code: "SCHEMA_CHANGE_OF_REMOVED_PLUGINS_ELEMENT",
        message:
          `This schema change would ${change.act} the ${noun} "${change.name}" on the table "${change.table}"${why ?? ""}, which the plugin "${ownerId}" added. ` +
          `"${ownerId}" is no longer in the configuration, so its ${noun} is kept as it is and nothing was applied. ` +
          `Add "${ownerId}" back to the configuration, or run \`nextly plugins uninstall ${ownerId}\` to remove what it added, then apply the change again.`,
      },
    ],
    logContext: {
      reason: "removed-plugin-element",
      table: change.table,
      elementKind: change.kind,
      elementName: change.name,
      ownerId,
      act: change.act,
    },
  });
}

/**
 * Refuse a push that would drop, rename or change an element an owner row
 * records for a plugin that declares no schema any more.
 *
 * The kept elements are already in the desired state, so what reaches here
 * is a change another owner's declaration plans for one: a field of the same
 * name with another shape, say. Also refused: a kept index or foreign key
 * over a column the table's owner removes, which the database would drop
 * with that column.
 */
export function refuseChangesToKeptElements(input: {
  operations: readonly Operation[];
  rows: readonly OwnerRecord[];
  declaring: ReadonlySet<string>;
  kept: readonly KeptElement[];
  desired: NextlySchemaSnapshot;
  live: NextlySchemaSnapshot;
}): void {
  const removed = new Map<string, string>();
  for (const row of input.rows) {
    const kind = row.elementKind ?? "table";
    if (kind === "table") continue;
    if (row.ownerKind !== "plugin" || input.declaring.has(row.ownerId)) {
      continue;
    }
    removed.set(
      `${row.tableName.toLowerCase()}\u0000${kind}\u0000${row.elementName ?? ""}`,
      row.ownerId
    );
  }
  if (removed.size === 0) return;
  for (const op of input.operations) {
    const change = changeOf(op);
    if (change === undefined) continue;
    const owner = removed.get(
      `${change.table.toLowerCase()}\u0000${change.kind}\u0000${change.name}`
    );
    if (owner !== undefined) throw keptElementRefusal(change, owner);
  }
  const desired = byName(input.desired);
  const live = byName(input.live);
  for (const element of input.kept) {
    if (element.kind !== "index" && element.kind !== "fk") continue;
    const columns = new Set(
      desired.get(element.table.toLowerCase())?.columns.map(c => c.name) ?? []
    );
    const liveTable = live.get(element.table.toLowerCase());
    const spec =
      element.kind === "index"
        ? liveTable?.indexes?.find(e => e.name === element.name)
        : liveTable?.foreignKeys?.find(e => e.name === element.name);
    const gone = (spec?.columns ?? []).find(column => !columns.has(column));
    if (gone === undefined) continue;
    throw keptElementRefusal(
      { table: element.table, kind: element.kind, name: element.name, act: "drop" },
      element.ownerId,
      ` with the column "${gone}"`
    );
  }
}

/** The kept elements on one table, by kind. */
export function keptOn(
  kept: readonly KeptElement[],
  table: string
): KeptElement[] {
  return kept.filter(e => e.table.toLowerCase() === table.toLowerCase());
}

/**
 * Refuse a SQLite rebuild of a table that holds a kept column, foreign key or
 * check.
 *
 * drizzle-kit rebuilds a SQLite table from its runtime definition, which is
 * built from the configuration and so has none of them: the rebuilt table
 * would come back without the column and its values, or without the key or
 * the check. A kept index is put back after a rebuild, as every tracked index
 * is, so it does not refuse one.
 */
export function refuseRebuildsLosingKeptElements(
  rebuilt: Iterable<string>,
  kept: readonly KeptElement[]
): void {
  for (const table of rebuilt) {
    const lost = keptOn(kept, table).find(e => e.kind !== "index");
    if (lost === undefined) continue;
    throw keptElementRefusal(
      { table: lost.table, kind: lost.kind, name: lost.name, act: "drop" },
      lost.ownerId,
      ` by rebuilding the table, which SQLite needs for this change`
    );
  }
}

/** One line naming what the push kept, for the developer's log. */
export function describeKept(kept: readonly KeptElement[]): string {
  const byOwner = new Map<string, string[]>();
  for (const element of kept) {
    const list = byOwner.get(element.ownerId) ?? [];
    list.push(`${ELEMENT_NOUNS[element.kind]} "${element.name}" on "${element.table}"`);
    byOwner.set(element.ownerId, list);
  }
  return [...byOwner]
    .map(
      ([owner, list]) =>
        `kept what the plugin "${owner}" added, which is no longer configured (${list.join(", ")}); \`nextly plugins uninstall ${owner}\` removes it`
    )
    .join("; ");
}

/** What the push read and wrote of the owner rows, for the steps after it. */
export interface PushElementOwners {
  /** Every owner row, as it stands once the push has recorded its own. */
  rows: OwnerRecord[];
  /** The owners the configuration still declares schema for. */
  declaring: Set<string>;
}

/**
 * Read the owner rows a push judges by, and bring the element rows up to date
 * first when `record` is set.
 *
 * Retires the element rows on the tables the push introspected whose element
 * is gone from both the configuration and the database (`retiredElementRows`),
 * so a name an earlier owner left behind cannot claim a new owner's element.
 * Then records each element the configuration contributes that has no row
 * yet, refusing one another owner's row already claims (`assertNoOwnerChange`)
 * as `nextly migrate` does.
 *
 * `undefined` when the registry is not there yet (a database that predates
 * it): nothing is recorded, and the push keeps nothing, as before. Whether it
 * exists is asked of the catalog, never learned from a failed read.
 */
export async function pushElementOwners(input: {
  db: unknown;
  dialect: SupportedDialect;
  schema: ContributionSource | null;
  /** The tables the push introspected (`live` holds the ones that exist). */
  managedTables: readonly string[];
  live: NextlySchemaSnapshot;
  record: boolean;
}): Promise<PushElementOwners | undefined> {
  const [
    { introspectTableNames },
    { SCHEMA_OWNERS_TABLE },
    { SchemaOwnersRepository },
    { retiredElementRows },
    { assertNoOwnerChange },
  ] = await Promise.all([
    import("../pipeline/diff/introspect-live"),
    import("../../../schemas/schema-owners"),
    import("./schema-owners-repository"),
    import("./retired-elements"),
    import("./owner-registry"),
  ]);
  let exists: boolean;
  try {
    exists =
      (await introspectTableNames(input.db, input.dialect, [SCHEMA_OWNERS_TABLE]))
        .length > 0;
  } catch {
    // A handle that cannot answer a catalog question (a stub in a unit test)
    // has no registry either.
    return undefined;
  }
  if (!exists) return undefined;
  const repository = new SchemaOwnersRepository(input.db, input.dialect);
  const declaring = declaringOwners(input.schema, input.dialect);
  let rows = await repository.read();
  if (!input.record) return { rows, declaring };

  const contributed = contributedElements(input.schema, input.dialect);
  const managed = new Set(input.managedTables.map(t => t.toLowerCase()));
  const retired = retiredElementRows({
    rows: rows.filter(row => managed.has(row.tableName.toLowerCase())),
    declared: groupByTable(contributed),
    live: input.live,
  });
  for (const row of retired) {
    await repository.deleteElement(row.tableName, row.elementKind, row.elementName ?? "");
  }
  const gone = new Set(retired.map(row => ownerRecordKey(row)));
  rows = rows.filter(row => !gone.has(ownerRecordKey(row)));

  assertNoOwnerChange(
    contributed.map(element => ({
      tableName: element.table,
      elementKind: element.elementKind,
      elementName: element.elementName,
      ownerId: ownerIdOf(element.owner),
    })),
    rows
  );
  const added = ownerRowsToRecord(
    contributed,
    new Set(input.schema?.owners.keys() ?? []),
    rows
  );
  await repository.upsert(added);
  return { rows: [...rows, ...added], declaring };
}

/** Contributed elements grouped by table, as `retiredElementRows` reads them. */
function groupByTable(
  contributed: readonly ContributedElement[]
): Map<string, Array<Omit<ContributedElement, "table">>> {
  const out = new Map<string, Array<Omit<ContributedElement, "table">>>();
  for (const { table, ...element } of contributed) {
    out.set(table, [...(out.get(table) ?? []), element]);
  }
  return out;
}
