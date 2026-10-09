/**
 * Who owns each table, and which migration stream carries it.
 *
 * Two questions that read as one and are not. A plugin-contributed collection
 * is DECLARED by the plugin and MIGRATED by the app, so a single "owner"
 * column would have to be wrong about one of them — and the wrong one decides
 * whether a drop is safe.
 *
 * ## What a missing row means
 *
 * A table with NO row is one nobody has claimed, and only the app's own
 * migrations may drop it: the app stream carries collection, Single and
 * component tables, which have none. Dev push never drops it, and a plugin's
 * migration is refused it (`assertNoForeignDrops`): an unrecognised table is
 * far more likely to be someone's data than a stray.
 *
 * ## Why ownership cannot be re-derived from config
 *
 * Config says what SHOULD exist. This says what DOES. The difference is the
 * whole point: a table whose plugin has been removed from config is exactly
 * the case where dropping it would destroy data, and config can no longer say
 * it was ever a plugin's. A record that outlives the declaration is what makes
 * an uninstall a decision rather than an accident.
 *
 * @module domains/schema/ownership/owner-registry
 * @since 1.0.0
 */
import { NextlyError } from "../../../errors/nextly-error";

export type OwnerKind =
  | "core"
  | "collection"
  | "single"
  | "component"
  | "plugin"
  | "app";

export type OwnerState = "active" | "orphaned" | "uninstalled";

export interface OwnerRecord {
  tableName: string;
  /**
   * `table` (the default and the pre-element meaning) or the kind of an
   * ELEMENT somebody added to a table another owner declared: `column`,
   * `index`, `fk`, `check`.
   */
  elementKind?: "table" | "column" | "index" | "fk" | "check";
  /** The element's name; `''` for a table-level row. */
  elementName?: string;
  ownerKind: OwnerKind;
  /** `nextly` | entity slug | plugin name | `app`. */
  ownerId: string;
  /** `core` | `app` | `plugin:<name>` — which stream carries the table. */
  migratedBy: string;
  ownerVersion: string | null;
  schemaVersion: number | null;
  state: OwnerState;
}

/**
 * The storage this service reads and writes.
 *
 * An interface rather than the Drizzle table directly, so the POLICY — what a
 * transfer means, which states are reachable — can be tested without a
 * database, and so the one implementation that touches SQL is the only thing
 * that has to be right about three dialects.
 */
export interface OwnerRegistryStore {
  read(tableNames?: readonly string[]): Promise<OwnerRecord[]>;
  upsert(rows: readonly OwnerRecord[]): Promise<void>;
  deleteByOwner(ownerId: string): Promise<void>;
}

export interface OwnerRegistry {
  get(tableName: string): Promise<OwnerRecord | null>;
  listByOwner(ownerId: string): Promise<OwnerRecord[]>;
  record(
    rows: readonly OwnerRecord[],
    opts?: { transfer?: boolean }
  ): Promise<void>;
  setState(ownerId: string, state: OwnerState): Promise<void>;
  remove(ownerId: string): Promise<void>;
  appliedSchemaVersion(ownerId: string): Promise<number | null>;
}

/**
 * The composite identity an owner row is keyed by: its table, element kind
 * and element name. A table-level row and an element row on the same table
 * are different claims.
 */
export function ownerRecordKey(
  row: Pick<OwnerRecord, "tableName" | "elementKind" | "elementName">
): string {
  return `${row.tableName}\u0000${row.elementKind ?? "table"}\u0000${row.elementName ?? ""}`;
}

/**
 * Refuse rows that would give a table or element a different owner than the
 * row already recorded for it.
 *
 * A silent owner change is how one plugin takes over another's table: the
 * second plugin declares the same name, the row is rewritten, and the drop
 * guard then lets the newcomer drop data the first plugin's row protected.
 * Called before the work that would record the change, and again by
 * `record` on the rows as they stand when it writes.
 */
export function assertNoOwnerChange(
  rows: ReadonlyArray<
    Pick<OwnerRecord, "tableName" | "elementKind" | "elementName" | "ownerId">
  >,
  existing: Iterable<OwnerRecord>
): void {
  const recorded = new Map<string, OwnerRecord>();
  for (const row of existing) recorded.set(ownerRecordKey(row), row);
  for (const row of rows) {
    const before = recorded.get(ownerRecordKey(row));
    if (before === undefined || before.ownerId === row.ownerId) continue;
    throw ownerChangeRefusal(row, before.ownerId);
  }
}

/** How a refusal names each kind of element an owner row can record. */
const ELEMENT_NOUNS: Record<
  Exclude<NonNullable<OwnerRecord["elementKind"]>, "table">,
  string
> = {
  column: "column",
  index: "index",
  fk: "foreign key",
  check: "check constraint",
};

/**
 * The refusal for `row` claiming what `from` already owns, naming what is
 * claimed: the table for a table-level row, or the column, index, foreign
 * key or check on it for an element row.
 */
function ownerChangeRefusal(
  row: Pick<
    OwnerRecord,
    "tableName" | "elementKind" | "elementName" | "ownerId"
  >,
  from: string
): NextlyError {
  const kind = row.elementKind ?? "table";
  const noun = kind === "table" ? "table" : ELEMENT_NOUNS[kind];
  const what =
    kind === "table"
      ? `The table "${row.tableName}"`
      : `The ${noun} "${row.elementName ?? ""}" on the table "${row.tableName}"`;
  return NextlyError.conflict({
    message: `${what} is recorded as belonging to "${from}", so "${row.ownerId}" cannot take it over. If "${from}" was removed and its ${noun} is meant to pass to "${row.ownerId}", delete "${from}"'s rows from nextly_schema_owners first.`,
    logContext: {
      reason:
        kind === "table"
          ? "table-owner-would-change"
          : "element-owner-would-change",
      table: row.tableName,
      elementKind: kind,
      elementName: row.elementName ?? "",
      from,
      to: row.ownerId,
    },
  });
}

export function createOwnerRegistry(store: OwnerRegistryStore): OwnerRegistry {
  return {
    async get(tableName) {
      const [row] = await store.read([tableName]);
      return row ?? null;
    },

    async listByOwner(ownerId) {
      const rows = await store.read();
      return rows.filter(row => row.ownerId === ownerId);
    },

    /**
     * Upsert, refusing to change an existing row's owner.
     *
     * A silent owner change is how one plugin takes over another's table: the
     * second plugin declares the same name, the row is rewritten, and the
     * first plugin's uninstall then drops data it no longer appears to own.
     * `transfer: true` makes that an explicit act.
     */
    async record(rows, opts) {
      if (opts?.transfer !== true) {
        // Compared by the full key: a table's rows include the element rows
        // other owners hold on it, and an element row says nothing about who
        // owns the table.
        assertNoOwnerChange(
          rows,
          await store.read([...new Set(rows.map(row => row.tableName))])
        );
      }

      await store.upsert(rows);
    },

    async setState(ownerId, state) {
      const rows = await store.read();
      const mine = rows.filter(row => row.ownerId === ownerId);
      // Only this owner's rows. A state change that swept siblings would
      // mark another plugin's tables uninstalled on the strength of a name.
      if (mine.length === 0) return;
      await store.upsert(mine.map(row => ({ ...row, state })));
    },

    async remove(ownerId) {
      await store.deleteByOwner(ownerId);
    },

    /**
     * The highest schema version recorded for an owner.
     *
     * The highest rather than the first: an owner with several tables applied
     * across releases has a row per table, and the newest is what decides
     * whether its migrations are behind.
     */
    async appliedSchemaVersion(ownerId) {
      const rows = await store.read();
      const versions = rows
        .filter(row => row.ownerId === ownerId)
        .map(row => row.schemaVersion)
        .filter((value): value is number => typeof value === "number");
      return versions.length === 0 ? null : Math.max(...versions);
    },
  };
}
